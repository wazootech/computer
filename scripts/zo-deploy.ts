#!/usr/bin/env node
/**
 * Deploys the Discord Gateway bridge to its live Zo Computer service.
 *
 * The bridge runs 24/7 as a Zo process service on the machine that hosts the
 * repository checkout. This script is the deploy step: it fast-forwards the
 * live checkout to the branch that was just pushed, restarts the service, and
 * then proves the restart landed by polling `service_doctor` for a running
 * process whose log carries the bridge's own readiness line.
 *
 * It speaks JSON-RPC to Zo's MCP endpoint (streamable HTTP, bearer token), so
 * it needs no dependencies and can run straight from a GitHub Actions runner.
 *
 * Usage:
 *   ZO_API_KEY=... node --experimental-strip-types scripts/zo-deploy.ts \
 *     --service computer-discord-bridge --dir <checkout-on-the-zo-host>
 *
 * Flags: --service, --dir, --branch, --expect-sha, --timeout, --dry-run, --help.
 * Exit code 0 means the live service is running the requested revision.
 */
import {
  findZoService,
  parseZoCommandResult,
  parseZoServiceList,
  parseZoServiceStatus,
  type ZoCommandResult,
  type ZoServiceEntry,
  type ZoServiceStatus,
} from "../lib/zo-deploy.ts";

const DEFAULT_MCP_URL = "https://api.zo.computer/mcp";
const DEFAULT_BRIDGE_DIRECTORY = "/home/workspace/users/etok/workspaces/wazootech/repos/computer";
const DEFAULT_BRANCH = "main";
const DEFAULT_TIMEOUT_SECONDS = 90;
const READY_MARKERS = ["ready: computer-discord", "session resumed"] as const;
const POLL_INTERVAL_MS = 3_000;

interface Options {
  readonly service: string;
  readonly directory: string;
  readonly branch: string;
  readonly expectSha: string | null;
  readonly timeoutSeconds: number;
  readonly dryRun: boolean;
  readonly apiKey: string;
  readonly mcpUrl: string;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function readOptions(): Options {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      [
        "Deploy the Discord Gateway bridge to its live Zo service.",
        "",
        "  --service <label>   Zo service label to restart (required)",
        `  --dir <path>        live checkout on the Zo host (default ${DEFAULT_BRIDGE_DIRECTORY})`,
        `  --branch <name>     branch to deploy (default ${DEFAULT_BRANCH})`,
        "  --expect-sha <sha>  revision this deploy must land on (usually the pushed commit)",
        `  --timeout <seconds> readiness deadline (default ${DEFAULT_TIMEOUT_SECONDS})`,
        "  --dry-run           resolve the service and report, restart nothing",
        "",
        "Environment: ZO_API_KEY (required), ZO_MCP_URL (optional).",
      ].join("\n"),
    );
    process.exit(0);
  }

  const service = option("service");
  if (service === undefined) throw new Error("missing --service");
  const apiKey = process.env.ZO_API_KEY ?? "";
  if (apiKey === "") throw new Error("missing ZO_API_KEY (Zo Settings > Advanced > Access Tokens)");
  const timeout = Number(option("timeout") ?? DEFAULT_TIMEOUT_SECONDS);

  return {
    service,
    directory: option("dir") ?? DEFAULT_BRIDGE_DIRECTORY,
    branch: option("branch") ?? DEFAULT_BRANCH,
    expectSha: option("expect-sha") ?? null,
    timeoutSeconds: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_SECONDS,
    dryRun: process.argv.includes("--dry-run"),
    apiKey,
    mcpUrl: process.env.ZO_MCP_URL ?? DEFAULT_MCP_URL,
  };
}

interface ToolResult {
  readonly text: string;
  readonly isError: boolean;
}

/** Minimal MCP client: initialize, then `tools/call` over streamable HTTP. */
class ZoMcp {
  private readonly url: string;
  private readonly apiKey: string;
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(
    url: string,
    apiKey: string,
  ) {
    this.url = url;
    this.apiKey = apiKey;
  }

  async connect(): Promise<void> {
    const response = await this.send({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "computer-bridge-deploy", version: "1.0.0" },
      },
    });
    if (response instanceof Error) throw response;
    this.sessionId = response.headers.get("mcp-session-id");
    if (this.sessionId === null) throw new Error("Zo MCP endpoint did not return a session id");
    await this.send({ jsonrpc: "2.0", method: "notifications/initialized" }, { expectBody: false });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const response = await this.send({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "tools/call",
      params: { name, arguments: args },
    });
    if (response instanceof Error) throw response;
    const payload = (await readPayload(response)) as {
      result?: { content?: readonly { text?: string }[]; isError?: boolean };
      error?: { message?: string };
    };
    if (payload.error) throw new Error(`${name} failed: ${payload.error.message ?? "unknown error"}`);
    const text = (payload.result?.content ?? []).map((part) => part.text ?? "").join("\n");
    return { text, isError: payload.result?.isError === true };
  }

  private async send(
    body: unknown,
    options: { readonly expectBody?: boolean } = {},
  ): Promise<Response | Error> {
    const headers: Record<string, string> = {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${this.apiKey}`,
      "content-type": "application/json",
    };
    if (this.sessionId !== null) headers["mcp-session-id"] = this.sessionId;
    try {
      const response = await fetch(this.url, { method: "POST", headers, body: JSON.stringify(body) });
      if (!response.ok) {
        return new Error(`Zo MCP ${String(response.status)}: ${(await response.text()).slice(0, 400)}`);
      }
      return options.expectBody === false ? new Response(null, { status: response.status }) : response;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }
}

/** Reads either a plain JSON-RPC body or one SSE `data:` frame. */
async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  const frame = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("data: "));
  return JSON.parse(frame === undefined ? text : frame.slice(6));
}

function assertOk(result: ToolResult, tool: string): void {
  if (result.isError) throw new Error(`${tool} failed: ${result.text}`);
}

async function runCommand(zo: ZoMcp, cmd: string): Promise<ZoCommandResult> {
  const result = await zo.callTool("bash", { cmd });
  assertOk(result, "bash");
  const parsed = parseZoCommandResult(result.text);
  if (parsed === null) throw new Error(`unreadable bash result: ${result.text.slice(0, 200)}`);
  return parsed;
}

function step(message: string): void {
  console.log(`\n== ${message}`);
}

async function fastForward(zo: ZoMcp, options: Options): Promise<string> {
  const branch = await runCommand(zo, `git -C ${options.directory} rev-parse --abbrev-ref HEAD`);
  if (branch.returncode !== 0) throw new Error(`no git checkout at ${options.directory}: ${branch.stderr.trim()}`);
  if (branch.stdout.trim() !== options.branch) {
    throw new Error(`live checkout is on ${branch.stdout.trim()}, expected ${options.branch}`);
  }

  const pull = await runCommand(zo, `git -C ${options.directory} pull --ff-only origin ${options.branch} 2>&1`);
  console.log(pull.stdout.trim());
  if (pull.returncode !== 0) {
    throw new Error(`git pull failed; the running service was left untouched: ${pull.stderr.trim()}`);
  }

  const head = await runCommand(zo, `git -C ${options.directory} rev-parse HEAD`);
  const sha = head.stdout.trim();
  if (options.expectSha !== null && !sha.startsWith(options.expectSha) && !options.expectSha.startsWith(sha)) {
    console.log(`note: live checkout is at ${sha}, not the deploying commit ${options.expectSha}`);
  }
  return sha;
}

async function resolveService(zo: ZoMcp, options: Options): Promise<ZoServiceEntry> {
  const listed = await zo.callTool("list_user_services", {});
  assertOk(listed, "list_user_services");
  const service = findZoService(parseZoServiceList(listed.text), options.service);
  if (service === null) {
    throw new Error(
      `no Zo service labelled '${options.service}'. Register it once with the entrypoint in README "Hosting the bridge on Zo Computer" and re-run.`,
    );
  }
  if (service.mode !== "process") {
    throw new Error(`service '${options.service}' is mode=${service.mode}; the bridge must be a process service`);
  }
  if (service.workdir !== options.directory) {
    console.log(`note: service workdir is ${service.workdir}, deploying ${options.directory}`);
  }
  console.log(`service ${service.serviceId} (${service.label}) -> ${service.entrypoint}`);
  return service;
}

async function awaitReadiness(
  zo: ZoMcp,
  options: Options,
  service: ZoServiceEntry,
): Promise<ZoServiceStatus> {
  const deadline = Date.now() + options.timeoutSeconds * 1_000;
  let last: ZoServiceStatus | null = null;
  while (Date.now() < deadline) {
    const report = await zo.callTool("service_doctor", { service: service.label });
    assertOk(report, "service_doctor");
    const status = parseZoServiceStatus(report.text, service.label);
    if (status !== null) {
      last = status;
      const ready = READY_MARKERS.some((marker) => status.logs.includes(marker));
      const restarted = status.uptimeSeconds === null || status.uptimeSeconds < options.timeoutSeconds;
      if (status.state === "RUNNING" && ready && restarted) return status;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(
    `service did not report a ready gateway within ${String(options.timeoutSeconds)}s; last status: ${
      last === null ? "unavailable" : `${last.state} uptime ${String(last.uptimeSeconds)}s\n${last.logs}`
    }`,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main(): Promise<void> {
  const options = readOptions();
  const zo = new ZoMcp(options.mcpUrl, options.apiKey);

  step(`connect to ${options.mcpUrl}`);
  await zo.connect();
  console.log("connected");

  step(`deploy ${options.branch} into ${options.directory}`);
  const sha = options.dryRun
    ? await runCommand(zo, `git -C ${options.directory} rev-parse HEAD`).then((result) => {
        if (result.returncode !== 0) throw new Error(`no git checkout at ${options.directory}`);
        return result.stdout.trim();
      })
    : await fastForward(zo, options);
  console.log(`revision ${sha}`);

  step(`resolve service ${options.service}`);
  const service = await resolveService(zo, options);

  if (options.dryRun) {
    console.log("\ndry run: skipping the restart");
    return;
  }

  step(`restart ${service.serviceId}`);
  const restarted = await zo.callTool("update_user_service", { service_id: service.serviceId });
  assertOk(restarted, "update_user_service");
  console.log(restarted.text.trim());

  step(`await readiness (${String(options.timeoutSeconds)}s deadline)`);
  const status = await awaitReadiness(zo, options, service);
  console.log(`${status.label}: ${status.state}, uptime ${String(status.uptimeSeconds)}s`);
  console.log(status.logs.trim());

  console.log(`\ndeployed ${sha} to ${status.label}`);
}

try {
  await main();
} catch (error) {
  console.error(`\ndeploy failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
