import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redact } from "../../agent/lib/redaction.ts";
import { validateAcceptanceTarget, type AcceptanceTarget } from "../preflight.ts";

export type RepeatabilityStatus = "success" | "flawed" | "blocked" | "manual";

export type TraceEvent = {
  id: string;
  kind: string;
  detail: string;
  timestamp: string;
  temporaryPath?: string;
};

type CleanupLedger = {
  register(resource: string): void;
  complete(resource: string): void;
  inspect(): { attempted: boolean; residualResources: string[] };
};

type EffectLedger = {
  modelCalls: number;
  githubMutations: number;
  branchPushes: number;
  pullRequestsCreated: number;
};

export type ReplayContext = {
  clock: { now(): string };
  ids: { next(): string };
  emit(event: Omit<TraceEvent, "id" | "timestamp"> & Partial<Pick<TraceEvent, "id" | "timestamp">>): void;
  effects: {
    modelCall(meta: Record<string, unknown>): never;
    githubMutation(meta: Record<string, unknown>): never;
    branchPush(meta: Record<string, unknown>): never;
    pullRequestCreated(meta: Record<string, unknown>): never;
  };
  cleanup: CleanupLedger;
  redact(value: unknown): unknown;
};

export type ReplayAdapter = (target: AcceptanceTarget, runNumber: 1 | 2, context: ReplayContext) => Promise<void>;

export type RepeatabilityOptions = {
  adapter?: ReplayAdapter;
  redact?: (value: unknown) => unknown;
};

type ReplayRun = {
  canonicalTrace: TraceEvent[];
  cleanupPassed: boolean;
  cleanupEvidence: { attempted: boolean; residualResources: string[] };
  githubMutations: number;
  modelCalls: number;
  branchPushes: number;
  pullRequestsCreated: number;
  redactionPassed: boolean;
  traceDigest: string;
};

export type RepeatabilityEvidence = {
  harnessVersion: string;
  target: AcceptanceTarget;
  outcome: RepeatabilityStatus;
  evidenceComplete: boolean;
  cleanupPassed: boolean;
  redactionPassed: boolean;
  sideEffectsForbidden: boolean;
  tracesEqual: boolean;
  runs: ReplayRun[];
};

const HARNESS_VERSION = "repeatability-v2";
const RAW_SECRET = "Authorization: Bearer fixture-secret-123";
const FIXED_TIME = "2026-01-01T00:00:00.000Z";

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

export function canonicalizeRunTrace(events: readonly TraceEvent[], worktreePath?: string, redactValue: (value: unknown) => unknown = redact): TraceEvent[] {
  const canonicalizePath = (value: string): string => worktreePath ? value.split(worktreePath).join("<WORKTREE>") : value;
  return events.map((event) => ({
    detail: canonicalizePath(String(redactValue(event.detail))),
    id: event.id,
    kind: event.kind,
    timestamp: event.timestamp,
    ...(event.temporaryPath ? { temporaryPath: canonicalizePath(event.temporaryPath) } : {}),
  }));
}

function createContext(redactValue: (value: unknown) => unknown): { context: ReplayContext; effects: EffectLedger; cleanup: CleanupLedger } {
  const events: TraceEvent[] = [];
  const effects: EffectLedger = { branchPushes: 0, githubMutations: 0, modelCalls: 0, pullRequestsCreated: 0 };
  const resources = new Set<string>();
  let cleanupAttempted = false;
  let id = 0;
  const cleanup: CleanupLedger = {
    register(resource) { cleanupAttempted = true; resources.add(resource); },
    complete(resource) { cleanupAttempted = true; resources.delete(resource); },
    inspect() { return { attempted: cleanupAttempted, residualResources: [...resources].sort() }; },
  };
  const effect = (name: keyof EffectLedger, meta: Record<string, unknown>): never => {
    effects[name] += 1;
    throw new Error(`forbidden side effect attempted: ${name}:${JSON.stringify(redactValue(meta))}`);
  };
  const context: ReplayContext = {
    clock: { now: () => FIXED_TIME },
    ids: { next: () => `event-${++id}` },
    emit(event) {
      events.push({ id: event.id ?? `event-${++id}`, kind: event.kind, detail: event.detail, timestamp: event.timestamp ?? FIXED_TIME, temporaryPath: event.temporaryPath });
    },
    effects: {
      branchPush: (meta) => effect("branchPushes", meta),
      githubMutation: (meta) => effect("githubMutations", meta),
      modelCall: (meta) => effect("modelCalls", meta),
      pullRequestCreated: (meta) => effect("pullRequestsCreated", meta),
    },
    cleanup,
    redact: redactValue,
  };
  Object.defineProperty(context, "__events", { value: events });
  return { cleanup, context, effects };
}

const defaultAdapter: ReplayAdapter = async (_target, _runNumber, context) => {
  const worktreePath = mkdtempSync(join(tmpdir(), "computer-repeatability-"));
  context.cleanup.register(worktreePath);
  context.emit({ kind: "preflight.completed", detail: "fixture target validated" });
  context.emit({ kind: "stage.classifier.completed", detail: "fixture classification accepted" });
  context.emit({ kind: "stage.researcher.completed", detail: `fixture worktree ${worktreePath}`, temporaryPath: worktreePath });
  context.emit({ kind: "stage.analyst.completed", detail: "fixture analysis accepted" });
  context.emit({ kind: "stage.implementer.completed", detail: "fixture implementation prepared" });
  context.emit({ kind: "stage.reviewer.completed", detail: RAW_SECRET });
  rmSync(worktreePath, { force: true, recursive: true });
  context.cleanup.complete(worktreePath);
  context.emit({ kind: "cleanup.completed", detail: "temporary worktree removed" });
};

async function replayOnce(target: AcceptanceTarget, runNumber: 1 | 2, adapter: ReplayAdapter, redactValue: (value: unknown) => unknown): Promise<ReplayRun> {
  const { context, effects, cleanup } = createContext(redactValue);
  let events: TraceEvent[] = [];
  try {
    await adapter(target, runNumber, context);
  } catch (error) {
    context.emit({ kind: "adapter.failed", detail: error instanceof Error ? error.message : "adapter failed" });
  }
  events = (context as ReplayContext & { __events: TraceEvent[] }).__events;
  const cleanupEvidence = cleanup.inspect();
  const canonicalTrace = canonicalizeRunTrace(events, events.find((event) => event.temporaryPath)?.temporaryPath, redactValue);
  const serialized = JSON.stringify(canonicalTrace);
  return {
    branchPushes: effects.branchPushes,
    canonicalTrace,
    cleanupEvidence,
    cleanupPassed: cleanupEvidence.attempted && cleanupEvidence.residualResources.length === 0,
    githubMutations: effects.githubMutations,
    modelCalls: effects.modelCalls,
    pullRequestsCreated: effects.pullRequestsCreated,
    redactionPassed: !serialized.includes(RAW_SECRET) && serialized.includes("[REDACTED]"),
    traceDigest: digest(canonicalTrace),
  };
}

type AcceptanceSignals = {
  cleanupPassed: boolean;
  evidenceComplete: boolean;
  humanApprovalPending?: boolean;
  redactionPassed: boolean;
  sideEffectsForbidden: boolean;
  tracesEqual: boolean;
};

export function classifyAcceptanceOutcome(signals: AcceptanceSignals): RepeatabilityStatus {
  if (signals.humanApprovalPending) return "manual";
  if (!signals.evidenceComplete) return "blocked";
  if (!signals.cleanupPassed || !signals.redactionPassed || !signals.sideEffectsForbidden || !signals.tracesEqual) return "flawed";
  return "success";
}

export async function runRepeatabilityReplay(target: AcceptanceTarget, options: RepeatabilityOptions = {}): Promise<RepeatabilityEvidence> {
  const validation = validateAcceptanceTarget(target);
  if (!validation.ok) {
    return { cleanupPassed: false, evidenceComplete: false, harnessVersion: HARNESS_VERSION, outcome: "blocked", redactionPassed: false, runs: [], sideEffectsForbidden: true, target, tracesEqual: false };
  }

  const redactValue = options.redact ?? redact;
  const adapter = options.adapter ?? defaultAdapter;
  const runs = [await replayOnce(target, 1, adapter, redactValue), await replayOnce(target, 2, adapter, redactValue)];
  const tracesEqual = runs[0]?.traceDigest === runs[1]?.traceDigest;
  const sideEffectsForbidden = runs.every((run) => run.modelCalls === 0 && run.githubMutations === 0 && run.branchPushes === 0 && run.pullRequestsCreated === 0);
  const cleanupPassed = runs.every((run) => run.cleanupPassed);
  const redactionPassed = runs.every((run) => run.redactionPassed);
  const evidenceComplete = runs.length === 2 && runs.every((run) => run.canonicalTrace.length > 0 && run.cleanupEvidence.attempted);
  const outcome = classifyAcceptanceOutcome({ cleanupPassed, evidenceComplete, redactionPassed, sideEffectsForbidden, tracesEqual });
  return { cleanupPassed, evidenceComplete, harnessVersion: HARNESS_VERSION, outcome, redactionPassed, runs, sideEffectsForbidden, target, tracesEqual };
}
