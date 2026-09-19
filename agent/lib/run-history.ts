import { createHash } from "node:crypto";
import { BlobPreconditionFailedError, del, get, list, put } from "@vercel/blob";
import { RUN_HISTORY_PREFIX } from "./blob.js";
import { repositoryScopeKey, type RepositoryTarget } from "./github/repository-target.js";
import { redact, redactString } from "./redaction.js";

export const RUN_HISTORY_SCHEMA_VERSION = 1;
const MAX_EVENT_BYTES = 96_000;
const MAX_LISTED_EVENTS = 2_000;
const RETENTION_DAYS = Math.max(1, Number(process.env.RUN_HISTORY_RETENTION_DAYS ?? 30));

export const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u;

export function assertValidRunId(runId: string): string {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("runId contains unsupported characters");
  return runId;
}

export type RunHistoryStatus = "running" | "waiting" | "completed" | "failed" | "cancelled" | "expired" | "manual";

export type RunHistoryEventKind =
  | "run.started"
  | "run.waiting"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "run.expired"
  | "turn.started"
  | "turn.completed"
  | "turn.failed"
  | "turn.cancelled"
  | "stage.started"
  | "stage.completed"
  | "stage.failed"
  | "approval.requested"
  | "approval.resolved"
  | "action.started"
  | "action.completed"
  | "action.failed"
  | "output.recorded"
  | "intake.claimed"
  | "intake.decision"
  | "intake.promoted";

export type RunHistorySource = Readonly<{
  channel?: string;
  deliveryId?: string;
  event?: string;
  issueNumber?: number;
  pullRequestNumber?: number;
  type?: string;
}>;

export type RunHistoryEvent = Readonly<{
  schemaVersion: 1;
  recordType: "run-event";
  tenantScope: string;
  repositoryId: number;
  repositoryFullName: string;
  eventId: string;
  idempotencyKey: string;
  runId: string;
  rootRunId: string;
  parentRunId?: string;
  childRunId?: string;
  repository: RepositoryTarget;
  kind: RunHistoryEventKind;
  status?: RunHistoryStatus;
  stage?: string;
  sequence: string;
  occurredAt: string;
  ingestedAt: string;
  retentionExpiresAt: string;
  summary: string;
  source?: RunHistorySource;
  data?: unknown;
}>;

export type RunHistorySummary = Readonly<{
  schemaVersion: 1;
  recordType: "run-summary";
  tenantScope: string;
  repositoryId: number;
  repositoryFullName: string;
  runId: string;
  rootRunId: string;
  parentRunId?: string;
  repository: RepositoryTarget;
  status: RunHistoryStatus;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  retentionExpiresAt?: string;
  eventCount: number;
  lastEventId: string;
  lastSequence: string;
  source?: RunHistorySource;
}>;

export type RunHistoryRecord = Readonly<{
  summary: RunHistorySummary;
  events: readonly RunHistoryEvent[];
}>;

export interface RunHistoryStore {
  append(input: AppendRunHistoryInput, target: RepositoryTarget): Promise<{ duplicate: boolean; eventId: string; path: string; runId: string }>;
  read(target: RepositoryTarget, runId: string): Promise<{ found: true; path: string; record: RunHistoryRecord } | { found: false; path: string; reason?: "missing" | "expired" }>;
  list(target: RepositoryTarget, options?: RunHistoryListOptions): Promise<readonly RunHistorySummary[]>;
  remove(target: RepositoryTarget, runId: string): Promise<{ deleted: boolean; count: number }>;
}

export type RunHistoryListOptions = {
  limit?: number;
  status?: RunHistoryStatus;
  issueNumber?: number;
  pullRequestNumber?: number;
  deliveryId?: string;
  includeExpired?: boolean;
};

export type AppendRunHistoryInput = Readonly<{
  runId: string;
  rootRunId?: string;
  parentRunId?: string;
  childRunId?: string;
  idempotencyKey: string;
  kind: RunHistoryEventKind;
  status?: RunHistoryStatus;
  stage?: string;
  sequence?: string;
  occurredAt?: string;
  summary: string;
  source?: RunHistorySource;
  data?: unknown;
}>;

const segment = (value: string): string => encodeURIComponent(value);

const parseSegment = (value: string): string => decodeURIComponent(value);

const runPrefix = (target: RepositoryTarget, runId: string): string =>
  `${RUN_HISTORY_PREFIX}${repositoryScopeKey(target)}/runs/${segment(assertValidRunId(runId))}/`;

export const runHistoryRecordPath = (target: RepositoryTarget, runId: string): string =>
  `${runPrefix(target, runId)}record.json`;

export const runHistoryIndexPath = (target: RepositoryTarget, runId: string): string =>
  `${RUN_HISTORY_PREFIX}${repositoryScopeKey(target)}/index/${segment(assertValidRunId(runId))}.json`;

export const eventPath = (target: RepositoryTarget, runId: string, eventId: string): string =>
  `${runPrefix(target, runId)}events/${segment(eventId)}.json`;

const intakePrefix = (target: RepositoryTarget, issueNumber: number): string =>
  `${RUN_HISTORY_PREFIX}${repositoryScopeKey(target)}/intake/${issueNumber}/`;

const stableEventId = (runId: string, idempotencyKey: string): string =>
  `evt-${createHash("sha256").update(`${runId}:${idempotencyKey}`).digest("hex").slice(0, 32)}`;

const nowIso = (): string => new Date().toISOString();

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function boundedEventData(base: Omit<RunHistoryEvent, "data">, value: unknown): unknown {
  const redacted = redact(value);
  const fits = (data: unknown): boolean => byteLength(JSON.stringify({ ...base, data })) <= MAX_EVENT_BYTES;
  if (fits(redacted)) return redacted;
  const serialized = JSON.stringify(redacted);
  const codePoints = Array.from(serialized);
  const originalBytes = byteLength(serialized);
  let low = 0;
  let high = codePoints.length;
  let best = "";
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const content = codePoints.slice(0, middle).join("");
    const candidate = { truncated: true, originalBytes, content };
    if (fits(candidate)) {
      best = content;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return { truncated: true, originalBytes, content: best };
}

const retentionExpiry = (occurredAt: string): string =>
  new Date(Date.parse(occurredAt) + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

const statusForKind = (kind: RunHistoryEventKind, current: RunHistoryStatus = "running"): RunHistoryStatus => {
  switch (kind) {
    case "run.started":
    case "turn.started":
    case "stage.started":
    case "action.started":
      return current === "waiting" ? "running" : current;
    case "run.waiting":
    case "approval.requested":
      return "waiting";
    case "run.completed":
      return "completed";
    case "run.failed":
    case "stage.failed":
    case "turn.failed":
    case "action.failed":
      return "failed";
    case "run.cancelled":
    case "turn.cancelled":
      return "cancelled";
    default:
      return current;
  }
};

async function readJson<T>(path: string): Promise<T | null> {
  const result = await get(path, { access: "private", useCache: false });
  if (!result?.stream) return null;
  return JSON.parse(await new Response(result.stream).text()) as T;
}

async function listAll(prefix: string) {
  const blobs: Array<{ pathname: string }> = [];
  let cursor: string | undefined;
  do {
    const result = await list({ limit: 1_000, prefix, cursor });
    blobs.push(...result.blobs.map(({ pathname }) => ({ pathname })));
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);
  if (blobs.length > MAX_LISTED_EVENTS) throw new Error("Run history exceeds the configured event limit");
  return blobs;
}

function immutableComparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(immutableComparable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["claimedAt", "ingestedAt", "occurredAt", "retentionExpiresAt"].includes(key))
      .map(([key, child]) => [key, immutableComparable(child)]),
  );
}

async function putImmutable(path: string, value: unknown): Promise<boolean> {
  const contents = JSON.stringify(value);
  if (Buffer.byteLength(contents, "utf8") > MAX_EVENT_BYTES) throw new Error("Run history event exceeds the size limit");
  try {
    await put(path, contents, { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/json" });
    return false;
  } catch (error) {
    if (!(error instanceof BlobPreconditionFailedError)) throw error;
    const existing = await readJson<unknown>(path);
    if (existing === null) throw new Error(`Unable to verify existing idempotency record at ${path}`);
    if (JSON.stringify(immutableComparable(existing)) !== JSON.stringify(immutableComparable(value))) throw new Error(`Conflicting idempotency key at ${path}`);
    return true;
  }
}

const summarizeSource = (source: RunHistorySource | undefined): RunHistorySource | undefined => {
  if (!source) return undefined;
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined)) as RunHistorySource;
};

async function persistRunSummary(target: RepositoryTarget, runId: string): Promise<void> {
  const result = await readRunHistory(target, runId);
  if (!result.found) return;
  const body = JSON.stringify(result.record.summary);
  const options = {
    access: "private" as const,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  };
  await put(runHistoryRecordPath(target, runId), body, options);
  await put(runHistoryIndexPath(target, runId), body, options);
}

export async function appendRunHistoryEvent(input: AppendRunHistoryInput, target: RepositoryTarget) {
  const runId = assertValidRunId(input.runId);
  const rootRunId = assertValidRunId(input.rootRunId ?? runId);
  const parentRunId = input.parentRunId === undefined ? undefined : assertValidRunId(input.parentRunId);
  const childRunId = input.childRunId === undefined ? undefined : assertValidRunId(input.childRunId);
  const eventId = stableEventId(runId, input.idempotencyKey);
  const occurredAt = input.occurredAt ?? nowIso();
  const ingestedAt = nowIso();
  const retentionExpiresAt = retentionExpiry(occurredAt);
  let event: RunHistoryEvent = {
    data: input.data === undefined ? undefined : redact(input.data),
    eventId,
    idempotencyKey: redactString(input.idempotencyKey),
    kind: input.kind,
    occurredAt,
    parentRunId,
    childRunId,
    recordType: "run-event",
    repository: target,
    repositoryFullName: target.fullName,
    repositoryId: target.id,
    rootRunId,
    runId,
    schemaVersion: RUN_HISTORY_SCHEMA_VERSION,
    sequence: input.sequence ?? `${occurredAt}:${eventId}`,
    source: summarizeSource(input.source),
    stage: input.stage,
    status: input.status ?? statusForKind(input.kind),
    summary: redactString(input.summary).slice(0, 4_000),
    tenantScope: repositoryScopeKey(target),
    ingestedAt,
    retentionExpiresAt,
  };
  if (byteLength(JSON.stringify(event)) > MAX_EVENT_BYTES) {
    const { data, ...base } = event;
    event = { ...event, data: boundedEventData(base, data) };
  }
  const path = eventPath(target, runId, eventId);
  const duplicate = await putImmutable(path, event);
  try {
    await persistRunSummary(target, runId);
  } catch (error) {
    console.error("run history summary projection failed", error instanceof Error ? error.message : "unknown error");
  }
  return { duplicate, eventId, path, runId };
}

export async function startRunHistory(
  input: { runId: string; summary: string; title: string; source?: RunHistorySource },
  target: RepositoryTarget,
) {
  return appendRunHistoryEvent({
    idempotencyKey: `run:${input.runId}`,
    kind: "run.started",
    runId: input.runId,
    source: input.source,
    status: "running",
    summary: `${input.title}: ${input.summary}`,
  }, target);
}

export async function readRunHistory(target: RepositoryTarget, runId: string): Promise<{ found: true; path: string; record: RunHistoryRecord } | { found: false; path: string; reason?: "missing" | "expired" }> {
  const validatedRunId = assertValidRunId(runId);
  const prefix = runPrefix(target, validatedRunId);
  const tombstone = await readJson<{ reason?: string }>(`${prefix}tombstone.json`);
  if (tombstone) return { found: false, path: runHistoryRecordPath(target, validatedRunId), reason: "expired" };
  const blobs = await listAll(`${prefix}events/`);
  if (blobs.length === 0) return { found: false, path: runHistoryRecordPath(target, validatedRunId), reason: "missing" };
  const events = (await Promise.all(blobs.map(({ pathname }) => readJson<RunHistoryEvent>(pathname))))
    .filter((event): event is RunHistoryEvent => event !== null)
    .sort((a, b) => a.sequence.localeCompare(b.sequence) || a.occurredAt.localeCompare(b.occurredAt) || a.eventId.localeCompare(b.eventId));
  if (events.length === 0) return { found: false, path: runHistoryRecordPath(target, validatedRunId), reason: "missing" };
  const first = events[0];
  const last = events[events.length - 1];
  if (!first || !last) return { found: false, path: runHistoryRecordPath(target, validatedRunId), reason: "missing" };
  const terminalEvent = events.find((event, index) => {
    const prior = index === 0 ? "running" as RunHistoryStatus : statusForKind(events[index - 1]?.kind ?? "run.started", events[index - 1]?.status ?? "running");
    return ["completed", "failed", "cancelled", "manual"].includes(statusForKind(event.kind, event.status ?? prior));
  });
  const endedAt = terminalEvent?.occurredAt;
  const retentionExpiresAt = endedAt ? retentionExpiry(endedAt) : undefined;
  const status = events.reduce((current, event) => statusForKind(event.kind, event.status ?? current), "running" as RunHistoryStatus);
  const summary: RunHistorySummary = {
    endedAt: terminalEvent?.occurredAt,
    eventCount: events.length,
    lastEventId: last.eventId,
    lastSequence: last.sequence,
    parentRunId: first.parentRunId,
    repository: first.repository,
    rootRunId: first.rootRunId,
    runId: validatedRunId,
    schemaVersion: RUN_HISTORY_SCHEMA_VERSION,
    source: first.source,
    startedAt: first.occurredAt,
    status,
    updatedAt: last.occurredAt,
    recordType: "run-summary",
    tenantScope: repositoryScopeKey(target),
    repositoryId: target.id,
    repositoryFullName: target.fullName,
    retentionExpiresAt,
  };
  if (retentionExpiresAt && Date.parse(retentionExpiresAt) <= Date.now()) {
    return { found: false, path: runHistoryRecordPath(target, validatedRunId), reason: "expired" };
  }
  return { found: true, path: runHistoryRecordPath(target, validatedRunId), record: { events, summary } };
}

export async function listRunHistory(target: RepositoryTarget, options: RunHistoryListOptions = {}) {
  const blobs = await listAll(`${RUN_HISTORY_PREFIX}${repositoryScopeKey(target)}/index/`);
  const records = [];
  for (const { pathname } of blobs) {
    const summary = await readJson<RunHistorySummary>(pathname);
    if (!summary) continue;
    if (summary.retentionExpiresAt && Date.parse(summary.retentionExpiresAt) <= Date.now() && !options.includeExpired) continue;
    if (
      (!options.status || summary.status === options.status) &&
      (!options.issueNumber || summary.source?.issueNumber === options.issueNumber) &&
      (!options.pullRequestNumber || summary.source?.pullRequestNumber === options.pullRequestNumber) &&
      (!options.deliveryId || summary.source?.deliveryId === options.deliveryId)
    ) records.push(summary);
  }
  records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return records.slice(0, Math.max(1, Math.min(options.limit ?? 50, 100)));
}

export async function deleteRunHistory(target: RepositoryTarget, runId: string) {
  const validatedRunId = assertValidRunId(runId);
  const blobs = await listAll(runPrefix(target, validatedRunId));
  await Promise.all([
    ...blobs.map(({ pathname }) => del(pathname)),
    del(runHistoryIndexPath(target, validatedRunId)),
  ]);
  await put(`${runPrefix(target, validatedRunId)}tombstone.json`, JSON.stringify({ deletedAt: nowIso(), reason: "expired", runId: validatedRunId }), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
  return { deleted: blobs.length > 0, count: blobs.length };
}

export async function cleanupExpiredRunHistory(target: RepositoryTarget): Promise<number> {
  const summaries = await listRunHistory(target, { includeExpired: true, limit: 100 });
  let deleted = 0;
  for (const summary of summaries) {
    if (summary.retentionExpiresAt && Date.parse(summary.retentionExpiresAt) <= Date.now()) {
      await deleteRunHistory(target, summary.runId);
      deleted += 1;
    }
  }
  return deleted;
}

export async function claimIntakeDelivery(
  target: RepositoryTarget,
  input: { issueNumber: number; deliveryId: string; mode: "candidate" | "promoted" },
) {
  const path = `${intakePrefix(target, input.issueNumber)}${input.mode}/${segment(input.deliveryId)}.json`;
  const duplicate = await putImmutable(path, {
    deliveryId: input.deliveryId,
    issueNumber: input.issueNumber,
    mode: input.mode,
    repository: target,
    schemaVersion: RUN_HISTORY_SCHEMA_VERSION,
    claimedAt: nowIso(),
  });
  return { duplicate, path };
}

export async function claimIntakeDecision(
  target: RepositoryTarget,
  runId: string,
  input: { issueNumber: number; state: string },
): Promise<{ duplicate: boolean; path: string; issueNumber: number; state: string }> {
  const validatedRunId = assertValidRunId(runId);
  const path = `${RUN_HISTORY_PREFIX}${repositoryScopeKey(target)}/intake/decisions/${segment(validatedRunId)}.json`;
  const claim = {
    claimedAt: nowIso(),
    issueNumber: input.issueNumber,
    runId: validatedRunId,
    schemaVersion: RUN_HISTORY_SCHEMA_VERSION,
    state: input.state,
  };
  const duplicate = await putImmutable(path, claim);
  return { duplicate, issueNumber: input.issueNumber, path, state: input.state };
}

export async function releaseIntakeDelivery(
  target: RepositoryTarget,
  input: { issueNumber: number; deliveryId: string; mode: "candidate" | "promoted" },
): Promise<void> {
  const path = `${intakePrefix(target, input.issueNumber)}${input.mode}/${segment(input.deliveryId)}.json`;
  const claim = await readJson<{ deliveryId?: string }>(path);
  if (claim?.deliveryId === input.deliveryId) await del(path);
}

export const runHistoryPrefixFor = (target: RepositoryTarget, runId: string): string => runPrefix(target, runId);

export const blobRunHistoryStore: RunHistoryStore = {
  append: appendRunHistoryEvent,
  list: listRunHistory,
  read: readRunHistory,
  remove: deleteRunHistory,
};
