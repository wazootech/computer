import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SESSION_ID = "session-from-fake-zo";
const HEAD_SHA = "d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5";
const DEPLOYED_DIRECTORY = "/home/workspace/live-checkout";

const SERVICE_LIST = [
  "Services (1):",
  `  - service_id='svc_bridge123' label='computer-discord-bridge' mode='process' entrypoint='node --experimental-strip-types bridge/discord-gateway/index.ts'`,
  `    workdir='${DEPLOYED_DIRECTORY}' protocol='tcp'`,
].join("\n");

function doctorReport(input: { readonly logs: string; readonly state: string; readonly uptime: number }): string {
  return [
    "Host status: OK",
    "",
    "Services: 1",
    `  computer-discord-bridge: ${input.state}, uptime 00:00:${String(input.uptime).padStart(2, "0")}, pid 4812`,
    "",
    "Logs (last 10 lines):",
    ...input.logs.split("\n").map((line) => `  ${line}`),
  ].join("\n");
}

interface FakeZo {
  readonly calls: string[];
  readonly requests: readonly { readonly method: string; readonly sessionHeader: string | undefined }[];
  readonly restarts: string[];
  readonly urls: string;
  readonly close: () => Promise<void>;
  /** Doctor reads the restart flag, so readiness only appears after a restart. */
  readonly markRestarted: () => void;
  readonly setDoctor: (report: string) => void;
  readonly setPullReturncode: (code: number) => void;
}

function jsonRpc(response: ServerResponse, id: unknown, result: unknown, options: { readonly sse?: boolean } = {}): void {
  const payload = JSON.stringify({ jsonrpc: "2.0", id, result });
  if (options.sse === true) {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(`event: message\ndata: ${payload}\n\n`);
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(payload);
}

async function startFakeZo(): Promise<FakeZo> {
  const state = {
    calls: [] as string[],
    requests: [] as { method: string; sessionHeader: string | undefined }[],
    restarts: [] as string[],
    pullReturncode: 0,
    restarted: false,
    doctor: doctorReport({ logs: "bridge starting", state: "RUNNING", uptime: 600 }),
  };

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => {
      const message = JSON.parse(body) as {
        id?: unknown;
        method: string;
        params?: { arguments?: Record<string, unknown>; name?: string };
      };
      const sessionHeader = request.headers["mcp-session-id"];
      state.requests.push({
        method: message.method,
        sessionHeader: Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader,
      });
      if (message.method === "initialize") {
        response.setHeader("mcp-session-id", SESSION_ID);
        jsonRpc(response, message.id, { protocolVersion: "2025-06-18" }, { sse: true });
        return;
      }
      if (message.method === "notifications/initialized") {
        response.writeHead(202);
        response.end();
        return;
      }
      assert.equal(message.method, "tools/call");
      const name = message.params?.name ?? "";
      const args = message.params?.arguments ?? {};
      state.calls.push(name);

      if (name === "bash") {
        const cmd = String(args.cmd);
        if (cmd.includes("rev-parse --abbrev-ref")) {
          jsonRpc(response, message.id, { content: [{ type: "text", text: `CmdResult(stdout='main\\n', stderr='', returncode=0)` }] });
          return;
        }
        if (cmd.includes("pull --ff-only")) {
          const text =
            state.pullReturncode === 0
              ? "CmdResult(stdout='Updating 771d44e..d4e5f6a\\nFast-forward\\n', stderr='', returncode=0)"
              : "CmdResult(stdout='', stderr='error: Your local changes would be overwritten\\n', returncode=1)";
          jsonRpc(response, message.id, { content: [{ type: "text", text }] });
          return;
        }
        jsonRpc(response, message.id, { content: [{ type: "text", text: `CmdResult(stdout='${HEAD_SHA}\\n', stderr='', returncode=0)` }] });
        return;
      }
      if (name === "list_user_services") {
        jsonRpc(response, message.id, { content: [{ type: "text", text: SERVICE_LIST }] });
        return;
      }
      if (name === "update_user_service") {
        state.restarts.push(String(args.service_id));
        state.restarted = true;
        jsonRpc(response, message.id, { content: [{ type: "text", text: "Updated service svc_bridge123." }] });
        return;
      }
      assert.equal(name, "service_doctor");
      jsonRpc(response, message.id, { content: [{ type: "text", text: state.doctor }] });
    });
  });

  await new Promise<void>((resolveReady) => {
    server.listen(0, "127.0.0.1", resolveReady);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  return {
    calls: state.calls,
    requests: state.requests,
    restarts: state.restarts,
    urls: `http://127.0.0.1:${String(address !== null && typeof address === "object" ? address.port : 0)}/mcp`,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => {
          resolveClose();
        });
      }),
    markRestarted: () => {
      state.doctor = doctorReport({ logs: "bridge starting\ngateway ready", state: "RUNNING", uptime: 2 });
    },
    setDoctor: (report: string) => {
      state.doctor = report;
    },
    setPullReturncode: (code: number) => {
      state.pullReturncode = code;
    },
  };
}

interface DeployRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs the deploy script in a child process. `spawn` on purpose rather than
 * `spawnSync`: this test file also serves the fake Zo endpoint, and a blocking
 * spawn would keep the event loop from answering the child's requests.
 */
async function runDeploy(fake: FakeZo, extraFlags: readonly string[] = []): Promise<DeployRun> {
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "scripts/zo-deploy.ts",
      "--service",
      "computer-discord-bridge",
      "--dir",
      DEPLOYED_DIRECTORY,
      "--timeout",
      "15",
      ...extraFlags,
    ],
    {
      cwd: REPOSITORY_ROOT,
      env: { ...process.env, ZO_API_KEY: "test-key", ZO_MCP_URL: fake.urls },
    },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const status = await new Promise<number | null>((resolveExit) => {
    child.on("exit", (code) => {
      resolveExit(code);
    });
  });
  return { status, stdout, stderr };
}

describe("zo deploy script", () => {
  let fake: FakeZo;

  before(async () => {
    fake = await startFakeZo();
  });

  after(async () => {
    await fake.close();
  });

  it("fast-forwards, restarts once, and waits for the ready log line", async () => {
    fake.restarts.length = 0;
    fake.markRestarted();
    const run = await runDeploy(fake);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(fake.restarts, ["svc_bridge123"]);
    assert.match(run.stdout, /revision d4e5f6a/u);
    assert.match(run.stdout, /gateway ready/u);
    assert.match(run.stdout, /deployed d4e5f6a/u);
    assert.deepEqual(fake.calls.slice(0, 2), ["bash", "bash"]);
    assert.equal(fake.requests[0]?.method, "initialize");
    assert.equal(fake.requests[0]?.sessionHeader, undefined);
    assert.ok(fake.requests.slice(1).every((entry) => entry.sessionHeader === SESSION_ID));
  });

  it("leaves the running service untouched when the fast-forward fails", async () => {
    fake.restarts.length = 0;
    fake.setPullReturncode(1);
    const run = await runDeploy(fake);
    fake.setPullReturncode(0);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /git pull failed/u);
    assert.deepEqual(fake.restarts, []);
  });

  it("reports a service that never becomes ready", async () => {
    fake.setDoctor(doctorReport({ logs: "bridge starting\n{\"error\":\"bot identity check failed\"}", state: "FATAL", uptime: 1 }));
    const run = await runDeploy(fake, ["--timeout", "5"]);
    fake.markRestarted();
    assert.equal(run.status, 1);
    assert.match(run.stderr, /did not report a ready gateway/u);
    assert.match(run.stderr, /FATAL/u);
  });

  it("resolves everything and restarts nothing on a dry run", async () => {
    fake.restarts.length = 0;
    const run = await runDeploy(fake, ["--dry-run"]);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /dry run: skipping the restart/u);
    assert.deepEqual(fake.restarts, []);
  });
});
