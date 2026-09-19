import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransitionIntakeState,
  intakeStateForLabels,
  stateLabelsForTransition,
} from "../agent/lib/intake-policy.ts";
import {
  FACTORY_CANDIDATE_LABEL,
  FACTORY_NEEDS_CLARIFICATION_LABEL,
  FACTORY_QUEUED_LABEL,
  FACTORY_RUNNING_LABEL,
} from "../agent/lib/constants.ts";

test("candidate intake can queue only a concrete Wayfinder task", () => {
  assert.equal(canTransitionIntakeState([FACTORY_CANDIDATE_LABEL], "queued", true), true);
  assert.equal(canTransitionIntakeState([FACTORY_CANDIDATE_LABEL], "queued", false), false);
  assert.equal(canTransitionIntakeState([FACTORY_CANDIDATE_LABEL], "needs_clarification", false), true);
});

test("intake state transitions are monotonic and do not reopen running work", () => {
  assert.equal(canTransitionIntakeState([FACTORY_QUEUED_LABEL], "running", true), true);
  assert.equal(canTransitionIntakeState([FACTORY_RUNNING_LABEL], "queued", true), false);
  assert.equal(canTransitionIntakeState([FACTORY_NEEDS_CLARIFICATION_LABEL], "queued", true), true);
});

test("state labels are derived without preserving stale factory states", () => {
  assert.equal(intakeStateForLabels([FACTORY_CANDIDATE_LABEL, FACTORY_RUNNING_LABEL]), null);
  assert.deepEqual(stateLabelsForTransition([FACTORY_CANDIDATE_LABEL], "queued"), {
    add: [FACTORY_QUEUED_LABEL],
    remove: [FACTORY_CANDIDATE_LABEL],
  });
});
