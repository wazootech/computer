import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyAcceptanceOutcome,
  runRepeatabilityReplay,
} from "./acceptance/repeatability.ts";

const target = {
  baseSha: "a".repeat(40),
  disposable: true,
  issueNumber: 84,
  repository: "wazootech/wazoo-console",
  worktree: "/tmp/factory-acceptance",
};

test("repeatability replay produces identical redacted traces with no side effects", () => {
  const evidence = runRepeatabilityReplay(target);
  assert.equal(evidence.outcome, "success");
  assert.equal(evidence.tracesEqual, true);
  assert.equal(evidence.cleanupPassed, true);
  assert.equal(evidence.redactionPassed, true);
  assert.ok(evidence.runs.every((run) => run.modelCalls === 0 && run.githubMutations === 0));
});

test("invalid target is blocked before replay", () => {
  const evidence = runRepeatabilityReplay({ ...target, baseSha: "bad", disposable: false });
  assert.equal(evidence.outcome, "blocked");
  assert.equal(evidence.runs.length, 0);
  assert.equal(evidence.evidenceComplete, false);
});

test("outcome classifier preserves manual and flawed distinctions", () => {
  assert.equal(classifyAcceptanceOutcome({ cleanupPassed: true, evidenceComplete: true, humanApprovalPending: true, redactionPassed: true, sideEffectsForbidden: true, tracesEqual: true }), "manual");
  assert.equal(classifyAcceptanceOutcome({ cleanupPassed: false, evidenceComplete: true, redactionPassed: true, sideEffectsForbidden: true, tracesEqual: true }), "flawed");
  assert.equal(classifyAcceptanceOutcome({ cleanupPassed: true, evidenceComplete: false, redactionPassed: true, sideEffectsForbidden: true, tracesEqual: true }), "blocked");
});
