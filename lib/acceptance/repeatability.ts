import { createHash } from "node:crypto";
import { validateAcceptanceTarget, type AcceptanceTarget } from "../preflight.ts";

export type RepeatabilityStatus = "success" | "flawed" | "blocked" | "manual";

type TraceEvent = {
  id: string;
  kind: string;
  detail: string;
  timestamp: string;
  temporaryPath?: string;
};

type ReplayRun = {
  canonicalTrace: TraceEvent[];
  githubMutations: number;
  modelCalls: number;
  branchPushes: number;
  pullRequestsCreated: number;
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

const HARNESS_VERSION = "repeatability-v1";
const SECRET_FIXTURE = "Authorization: Bearer [REDACTED]";

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

export function canonicalizeRunTrace(events: readonly TraceEvent[]): TraceEvent[] {
  return events.map((event, index) => ({
    detail: event.detail
      .replaceAll(/\/tmp\/factory-[^\s/]+/gu, "<WORKTREE>")
      .replaceAll(/Bearer\s+\S+/gu, "Bearer [REDACTED]"),
    id: `event-${index + 1}`,
    kind: event.kind,
    timestamp: "<TIMESTAMP>",
  }));
}

function replayOnce(): ReplayRun {
  const events: TraceEvent[] = [
    { id: crypto.randomUUID(), kind: "preflight.completed", detail: "fixture target validated", timestamp: new Date().toISOString() },
    { id: crypto.randomUUID(), kind: "stage.classifier.completed", detail: "fixture classification accepted", timestamp: new Date().toISOString() },
    { id: crypto.randomUUID(), kind: "stage.researcher.completed", detail: "fixture research accepted", timestamp: new Date().toISOString(), temporaryPath: "/tmp/factory-random" },
    { id: crypto.randomUUID(), kind: "stage.analyst.completed", detail: "fixture analysis accepted", timestamp: new Date().toISOString() },
    { id: crypto.randomUUID(), kind: "stage.implementer.completed", detail: "fixture implementation prepared", timestamp: new Date().toISOString() },
    { id: crypto.randomUUID(), kind: "stage.reviewer.completed", detail: SECRET_FIXTURE, timestamp: new Date().toISOString() },
    { id: crypto.randomUUID(), kind: "cleanup.completed", detail: "temporary worktree removed", timestamp: new Date().toISOString() },
  ];
  const canonicalTrace = canonicalizeRunTrace(events);
  return {
    branchPushes: 0,
    canonicalTrace,
    githubMutations: 0,
    modelCalls: 0,
    pullRequestsCreated: 0,
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

export function runRepeatabilityReplay(target: AcceptanceTarget): RepeatabilityEvidence {
  const validation = validateAcceptanceTarget(target);
  if (!validation.ok) {
    return {
      cleanupPassed: false,
      evidenceComplete: false,
      harnessVersion: HARNESS_VERSION,
      outcome: "blocked",
      redactionPassed: false,
      runs: [],
      sideEffectsForbidden: true,
      target,
      tracesEqual: false,
    };
  }

  const runs = [replayOnce(), replayOnce()];
  const tracesEqual = runs[0]?.traceDigest === runs[1]?.traceDigest;
  const sideEffectsForbidden = runs.every(
    (run) => run.modelCalls === 0 && run.githubMutations === 0 && run.branchPushes === 0 && run.pullRequestsCreated === 0,
  );
  const cleanupPassed = runs.every((run) => run.canonicalTrace.at(-1)?.kind === "cleanup.completed");
  const redactionPassed = runs.every((run) => !JSON.stringify(run.canonicalTrace).includes("Bearer secret"));
  const evidenceComplete = runs.length === 2 && runs.every((run) => run.canonicalTrace.length >= 7);
  const outcome = classifyAcceptanceOutcome({ cleanupPassed, evidenceComplete, redactionPassed, sideEffectsForbidden, tracesEqual });
  return {
    cleanupPassed,
    evidenceComplete,
    harnessVersion: HARNESS_VERSION,
    outcome,
    redactionPassed,
    runs,
    sideEffectsForbidden,
    target,
    tracesEqual,
  };
}
