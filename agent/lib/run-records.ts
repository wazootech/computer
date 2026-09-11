import { randomUUID } from "node:crypto";
import { readDocument, writeDocument, RUN_RECORDS_PREFIX } from "./blob.js";
import type { RepositoryTarget } from "./github/repository-target.js";
import { repositoryScopeKey } from "./github/repository-target.js";
import { redact } from "./redaction.js";

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;

export type RunEvent = {
  failure?: unknown;
  kind: "stage" | "approval" | "output" | "failure";
  output?: unknown;
  stage: string;
  status: "started" | "completed" | "pending" | "approved" | "rejected" | "failed";
  summary: string;
  usage?: {
    inputTokens?: number;
    model?: string;
    outputTokens?: number;
    totalTokens?: number;
  };
};

const runIdFor = (runId: string): string => {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("runId contains unsupported characters");
  return runId;
};

export const runRecordPath = (target: RepositoryTarget, runId: string): string =>
  `${RUN_RECORDS_PREFIX}${repositoryScopeKey(target)}/${runIdFor(runId)}.md`;

const safeJson = (value: unknown): string => JSON.stringify(redact(value), null, 2);

export async function startRunRecord(
  input: { runId?: string; summary: string; title: string },
  target: RepositoryTarget
) {
  const runId = runIdFor(input.runId ?? `run-${randomUUID().slice(0, 12)}`);
  const path = runRecordPath(target, runId);
  const existing = await readDocument(path);
  if (existing.found) throw new Error(`Run record already exists: ${runId}`);
  const document = [
    `# ${redact(input.title)}`,
    "",
    `- Run ID: ${runId}`,
    `- Target repository: ${target.fullName} (${target.id})`,
    "- Status: running",
    `- Started at: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    redact(input.summary),
    "",
    "## Events",
    "",
  ].join("\n");
  await writeDocument(path, document, { allowOverwrite: false });
  return { path, runId };
}

export async function appendRunEvent(
  runId: string,
  event: RunEvent,
  target: RepositoryTarget
) {
  const path = runRecordPath(target, runId);
  const existing = await readDocument(path);
  if (!existing.found) throw new Error(`Run record not found: ${runId}`);
  const timestamp = new Date().toISOString();
  const safeEvent = redact({ ...event, timestamp });
  const next = `${existing.content.trimEnd()}\n\n### ${timestamp} · ${event.kind} · ${event.stage}\n\n\`\`\`json\n${safeJson(safeEvent)}\n\`\`\`\n`;
  await writeDocument(path, next, { allowOverwrite: true });
  return { path };
}
