import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeRunTrace,
  classifyAcceptanceOutcome,
  runRepeatabilityReplay,
  type ReplayAdapter,
} from "./acceptance/repeatability.ts";

const target = {
  baseSha: "a".repeat(40),
  disposable: true,
  issueNumber: 84,
  repository: "wazootech/wazoo-console",
  worktree: "/tmp/factory-acceptance",
};

test("repeatability replay produces identical redacted traces with no side effects", async () => {
  const evidence = await runRepeatabilityReplay(target);
  assert.equal(evidence.outcome, "success");
  assert.equal(evidence.tracesEqual, true);
  assert.equal(evidence.cleanupPassed, true);
  assert.equal(evidence.redactionPassed, true);
  assert.ok(evidence.runs.every((run) => run.modelCalls === 0 && run.githubMutations === 0));
});

test("invalid target is blocked before replay", async () => {
  const evidence = await runRepeatabilityReplay({ ...target, baseSha: "bad", disposable: false });
  assert.equal(evidence.outcome, "blocked");
  assert.equal(evidence.runs.length, 0);
  assert.equal(evidence.evidenceComplete, false);
});

test("injected effect attempts and cleanup failures cannot pass", async () => {
  const adapter: ReplayAdapter = async (_target, _runNumber, context) => {
    context.cleanup.register("leaked-worktree");
    context.emit({ kind: "fixture", detail: "safe" });
    context.effects.githubMutation({ endpoint: "/issues/84/labels" });
  };
  const evidence = await runRepeatabilityReplay(target, { adapter });
  assert.equal(evidence.outcome, "flawed");
  assert.equal(evidence.sideEffectsForbidden, false);
  assert.equal(evidence.cleanupPassed, false);
  assert.ok(evidence.runs.every((run) => run.githubMutations === 1));
});

test("changed event content remains unequal", async () => {
  const adapter: ReplayAdapter = async (_target, runNumber, context) => {
    context.emit({ kind: "fixture", detail: runNumber === 1 ? "same" : "changed" });
    context.cleanup.register("worktree");
    context.cleanup.complete("worktree");
    context.emit({ kind: "cleanup.completed", detail: "done" });
  };
  const evidence = await runRepeatabilityReplay(target, { adapter });
  assert.equal(evidence.tracesEqual, false);
  assert.equal(evidence.outcome, "flawed");
});

test("identity redactors fail closed", async () => {
  const evidence = await runRepeatabilityReplay(target, { redact: (value) => value });
  assert.equal(evidence.redactionPassed, false);
  assert.equal(evidence.outcome, "flawed");
});

test("outcome classifier preserves manual and flawed distinctions", () => {
  assert.equal(classifyAcceptanceOutcome({ cleanupPassed: true, evidenceComplete: true, humanApprovalPending: true, redactionPassed: true, sideEffectsForbidden: true, tracesEqual: true }), "manual");
  assert.equal(classifyAcceptanceOutcome({ cleanupPassed: false, evidenceComplete: true, redactionPassed: true, sideEffectsForbidden: true, tracesEqual: true }), "flawed");
  assert.equal(classifyAcceptanceOutcome({ cleanupPassed: true, evidenceComplete: false, redactionPassed: true, sideEffectsForbidden: true, tracesEqual: true }), "blocked");
});

test("canonicalizer redacts credentials and preserves event identity", () => {
  assert.deepEqual(canonicalizeRunTrace([
    {
      id: "event-7",
      kind: "fixture",
      detail: "Authorization: Bearer fixture-secret-123 in /tmp/factory-random",
      timestamp: "2026-01-01T00:00:00.000Z",
      temporaryPath: "/tmp/factory-random",
    },
  ], "/tmp/factory-random"), [{
    detail: "Authorization: Bearer [REDACTED] in <WORKTREE>",
    id: "event-7",
    kind: "fixture",
    timestamp: "2026-01-01T00:00:00.000Z",
    temporaryPath: "<WORKTREE>",
  }]);
});
