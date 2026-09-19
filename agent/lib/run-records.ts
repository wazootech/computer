import { randomUUID } from "node:crypto";
import { readDocument } from "./blob.js";
import { RUN_RECORDS_PREFIX } from "./blob.js";
import { appendRunHistoryEvent, readRunHistory, runHistoryRecordPath, startRunHistory, assertValidRunId, RUN_ID_PATTERN } from "./run-history.js";
import { repositoryScopeKey, type RepositoryTarget } from "./github/repository-target.js";

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

export const runRecordPath = (target: RepositoryTarget, runId: string): string =>
  runHistoryRecordPath(target, runId);

export const legacyRunRecordPath = (target: RepositoryTarget, runId: string): string =>
  `${RUN_RECORDS_PREFIX}${repositoryScopeKey(target)}/${encodeURIComponent(assertValidRunId(runId))}.md`;

export async function readLegacyRunRecord(target: RepositoryTarget, runId: string) {
  const path = legacyRunRecordPath(target, runId);
  const document = await readDocument(path);
  return document.found ? { path, content: document.content } : { path };
}

const kindFor = (event: RunEvent): "stage.started" | "stage.completed" | "stage.failed" | "approval.requested" | "approval.resolved" | "output.recorded" | "run.failed" => {
  if (event.kind === "failure") return "run.failed";
  if (event.kind === "approval") return event.status === "pending" ? "approval.requested" : "approval.resolved";
  if (event.kind === "output") return "output.recorded";
  if (event.status === "failed") return "stage.failed";
  return event.status === "started" ? "stage.started" : "stage.completed";
};

export async function startRunRecord(
  input: { runId?: string; summary: string; title: string },
  target: RepositoryTarget,
) {
  const runId = input.runId ?? `run-${randomUUID().slice(0, 12)}`;
  const result = await startRunHistory({ runId, summary: input.summary, title: input.title }, target);
  return { path: runRecordPath(target, runId), runId, duplicate: result.duplicate };
}

export async function appendRunEvent(runId: string, event: RunEvent, target: RepositoryTarget, idempotencyKey?: string) {
  const result = await appendRunHistoryEvent({
    data: { failure: event.failure, output: event.output, usage: event.usage },
    idempotencyKey: idempotencyKey ?? `manual:${event.kind}:${event.stage}:${event.status}:${event.summary}`,
    kind: kindFor(event),
    runId,
    stage: event.stage,
    status: event.status === "pending" ? "waiting" : event.status === "failed" ? "failed" : undefined,
    summary: event.summary,
  }, target);
  return { path: result.path, duplicate: result.duplicate };
}

export { RUN_ID_PATTERN, readRunHistory } from "./run-history.js";
