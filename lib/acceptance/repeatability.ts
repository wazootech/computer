import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactString } from "../../agent/lib/redaction.ts";
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
  cleanupPassed: boolean;
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

const HARNESS_VERSION = "repeatability-v1";

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

export function canonicalizeRunTrace(events: readonly TraceEvent[], worktreePath?: string): TraceEvent[] {
  const canonicalizePath = (value: string): string => worktreePath ? value.split(worktreePath).join("<WORKTREE>") : value;
  return events.map((event, index) => ({
    detail: canonicalizePath(redactString(event.detail)),
    id: `event-${index + 1}`,
    kind: event.kind,
    timestamp: "<TIMESTAMP>",
    ...(event.temporaryPath ? { temporaryPath: canonicalizePath(event.temporaryPath) } : {}),
  }));
}

function replayOnce(): ReplayRun {
  const worktreePath = mkdtempSync(join(tmpdir(), "computer-repeatability-"));
  const fixturePath = join(worktreePath, "fixture.txt");
  const rawSecret = "Authorization: Bearer fixture-secret-123";
  writeFileSync(fixturePath, `${rawSecret}\n`, "utf8");
  const events: TraceEvent[] = [
    { id: crypto.randomUUID(), kind: "preflight.completed", detail: "fixture target validated", timestamp: new Date().toISOString() },
    { id: crypto.randomUUID(), kind: "stage.classifier.completed", detail: "fixture classification accepted", timestamp: new Date().toISOString() },
    { id: crypto.randomUUID(), kind: "stage.researcher.completed", detail: `fixture worktree ${worktreePath}`, timestamp: new Date().toISOString(), temporaryPath: worktreePath },
    { id: crypto.randomUUID(), kind: "stage.analyst.completed", detail: "fixture analysis accepted", timestamp: new Date().toISOString() },
    { id: crypto.randomUUID(), kind: "stage.implementer.completed", detail: "fixture implementation prepared", timestamp: new Date().toISOString() },
    { id: crypto.randomUUID(), kind: "stage.reviewer.completed", detail: readFileSync(fixturePath, "utf8").trim(), timestamp: new Date().toISOString() },
  ];
  let cleanupError = false;
  try {
    rmSync(worktreePath, { force: true, recursive: true });
  } catch {
    cleanupError = true;
  }
  const cleanupPassed = !cleanupError && !existsSync(worktreePath);
  events.push({ id: crypto.randomUUID(), kind: "cleanup.completed", detail: `temporary worktree exists after cleanup: ${String(!cleanupPassed)}`, timestamp: new Date().toISOString() });
  const canonicalTrace = canonicalizeRunTrace(events, worktreePath);
  const reviewerDetail = canonicalTrace.find((event) => event.kind === "stage.reviewer.completed")?.detail;
  const redactionPassed = reviewerDetail === "Authorization: Bearer [REDACTED]" && !JSON.stringify(canonicalTrace).includes(rawSecret);
  return { branchPushes: 0, canonicalTrace, cleanupPassed, githubMutations: 0, modelCalls: 0, pullRequestsCreated: 0, redactionPassed, traceDigest: digest(canonicalTrace) };
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
    return { cleanupPassed: false, evidenceComplete: false, harnessVersion: HARNESS_VERSION, outcome: "blocked", redactionPassed: false, runs: [], sideEffectsForbidden: true, target, tracesEqual: false };
  }

  const runs = [replayOnce(), replayOnce()];
  const tracesEqual = runs[0]?.traceDigest === runs[1]?.traceDigest;
  const sideEffectsForbidden = runs.every((run) => run.modelCalls === 0 && run.githubMutations === 0 && run.branchPushes === 0 && run.pullRequestsCreated === 0);
  const cleanupPassed = runs.every((run) => run.cleanupPassed);
  const redactionPassed = runs.every((run) => run.redactionPassed);
  const evidenceComplete = runs.length === 2 && runs.every((run) => run.canonicalTrace.length >= 7);
  const outcome = classifyAcceptanceOutcome({ cleanupPassed, evidenceComplete, redactionPassed, sideEffectsForbidden, tracesEqual });
  return { cleanupPassed, evidenceComplete, harnessVersion: HARNESS_VERSION, outcome, redactionPassed, runs, sideEffectsForbidden, target, tracesEqual };
}
