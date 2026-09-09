import { createHash, randomUUID } from "node:crypto";
import { mintInstallationToken } from "../github/app-token.js";
import { redact, redactString } from "./redaction.js";

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const MEMORY_PATH_PATTERN = /^wiki\/[A-Za-z0-9_()\-]+\.md$/u;

type Repo = { owner: string; name: string };
type Content = { content: string; sha: string };

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  model?: string;
};

export type RunEvent = {
  stage: string;
  kind: "stage" | "approval" | "output" | "failure";
  status: "started" | "completed" | "pending" | "approved" | "rejected" | "failed";
  summary: string;
  output?: unknown;
  usage?: TokenUsage;
  failure?: unknown;
};

export type RunRecordStart = {
  runId: string;
  branch: string;
  path: string;
  pullRequestUrl: string;
};

const repoFromEnv = (): Repo => {
  const value = process.env.COMPUTER_MEMORY_REPO ?? "wazootech/computer-memory";
  const match = value.match(/^([^/]+)\/([^/]+)$/u);
  if (!match) throw new Error("COMPUTER_MEMORY_REPO must use owner/repo format");
  return { owner: match[1], name: match[2] };
};

const repo = repoFromEnv();

const assertMemoryPath = (path: string): void => {
  if (!MEMORY_PATH_PATTERN.test(path)) throw new Error("memory path must be one Markdown file under wiki/");
};

const assertRunId = (runId: string): void => {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("runId contains unsupported characters");
};

const runPath = (runId: string): string => {
  assertRunId(runId);
  return `wiki/Computer_Run_${runId}.md`;
};

const runBranch = (runId: string): string => {
  assertRunId(runId);
  return `computer/run/${runId}`;
};

const json = (value: unknown): string => JSON.stringify(redact(value), null, 2);

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await mintInstallationToken();
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": API_VERSION,
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`GitHub memory request returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

export async function readMemoryDocument(path: string, branch = "main"): Promise<Content | null> {
  assertMemoryPath(path);
  const token = await mintInstallationToken();
  const response = await fetch(`${API}/repos/${repo.owner}/${repo.name}/contents/${path}?ref=${encodeURIComponent(branch)}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub memory content request returned HTTP ${response.status}`);
  const body = (await response.json()) as { content?: string; sha?: string };
  if (!body.content || !body.sha) throw new Error("GitHub memory content response was incomplete");
  return { content: Buffer.from(body.content.replace(/\s/gu, ""), "base64").toString("utf8"), sha: body.sha };
}

async function writeMemoryDocument(path: string, branch: string, contents: string, message: string, sha?: string): Promise<void> {
  assertMemoryPath(path);
  await request(`/repos/${repo.owner}/${repo.name}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({
      branch,
      content: Buffer.from(contents, "utf8").toString("base64"),
      message: redactString(message),
      ...(sha ? { sha } : {}),
    }),
  });
}

async function createBranch(): Promise<{ branch: string; base: string }> {
  const repoInfo = await request<{ default_branch?: string }>(`/repos/${repo.owner}/${repo.name}`);
  const base = repoInfo.default_branch ?? "main";
  const ref = await request<{ object?: { sha?: string } }>(`/repos/${repo.owner}/${repo.name}/git/ref/heads/${encodeURIComponent(base)}`);
  const sha = ref.object?.sha;
  if (!sha) throw new Error("GitHub memory default branch ref omitted its SHA");
  const branch = `computer/memory/${randomUUID().slice(0, 12)}`;
  await request(`/repos/${repo.owner}/${repo.name}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });
  return { branch, base };
}

export async function writeMemoryProposal(input: { path: string; contents: string; title: string; body: string }): Promise<{ branch: string; pullRequestUrl: string }> {
  const { branch, base } = await createBranch();
  await writeMemoryDocument(input.path, branch, input.contents, `factory: update ${input.path}`);
  const pull = await request<{ html_url?: string }>(`/repos/${repo.owner}/${repo.name}/pulls`, {
    method: "POST",
    body: JSON.stringify({ base, body: redactString(input.body), draft: true, head: branch, title: redactString(input.title) }),
  });
  return { branch, pullRequestUrl: pull.html_url ?? "" };
}

const renderEvent = (event: RunEvent): string => {
  const lines = [
    `## ${redactString(event.stage)} · ${event.kind} · ${event.status}`,
    "",
    `- Recorded: ${new Date().toISOString()}`,
    `- Summary: ${redactString(event.summary)}`,
  ];
  if (event.usage) lines.push(`- Token usage: \`${json(event.usage)}\``);
  if (event.output !== undefined) lines.push("", "### Output", "", "```json", json(event.output), "```");
  if (event.failure !== undefined) lines.push("", "### Failure", "", "```json", json(event.failure), "```");
  return `${lines.join("\n")}\n`;
};

export async function startRunRecord(input: { title: string; summary: string; runId?: string }): Promise<RunRecordStart> {
  const runId = input.runId ?? randomUUID();
  const { branch, base } = await createBranch();
  const path = runPath(runId);
  const initial = [
    "---",
    "'@type': schema:TechArticle",
    `schema:name: Computer run ${runId}`,
    "schema:about: https://github.com/wazootech/computer",
    "memory:sourceRepository: https://github.com/wazootech/computer",
    `memory:runId: ${runId}`,
    "memory:recordKind: software-factory-run",
    "---",
    "",
    `# Computer run ${runId}`,
    "",
    redactString(input.title),
    "",
    `Started: ${new Date().toISOString()}`,
    "",
    renderEvent({ stage: "orchestrator", kind: "stage", status: "started", summary: input.summary }),
  ].join("\n");
  await writeMemoryDocument(path, branch, initial, `factory: start run ${runId}`);
  const pull = await request<{ html_url?: string }>(`/repos/${repo.owner}/${repo.name}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      base,
      body: `Redacted run record for Computer run ${runId}. This draft PR contains execution evidence only.`,
      draft: true,
      head: branch,
      title: `factory: record Computer run ${runId}`,
    }),
  });
  return { runId, branch, path, pullRequestUrl: pull.html_url ?? "" };
}

export async function appendRunEvent(runId: string, event: RunEvent): Promise<{ path: string; branch: string }> {
  const branch = runBranch(runId);
  const path = runPath(runId);
  const current = await readMemoryDocument(path, branch);
  if (!current) throw new Error(`Run record ${runId} does not exist`);
  const next = `${current.content.replace(/\s*$/u, "\n\n")}${renderEvent(event)}`;
  await writeMemoryDocument(path, branch, next, `factory: append ${event.stage} event to ${runId}`, current.sha);
  return { path, branch };
}

export const memoryRepository = (): string => `${repo.owner}/${repo.name}`;
export const stableRunId = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 16);
