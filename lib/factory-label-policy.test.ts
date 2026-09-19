import assert from "node:assert/strict";
import test from "node:test";
import { allowsFactoryLabelMutation } from "./factory-label-policy.ts";

test("factory terminal labels are limited to the originating issue", () => {
  const base = { originIssue: 84, runningLabel: "factory:running", terminalLabels: ["factory:completed", "factory:failed", "factory:manual"] };
  assert.equal(allowsFactoryLabelMutation({ ...base, issueNumber: 84, labels: ["factory:completed"], mode: "addLabels" }), true);
  assert.equal(allowsFactoryLabelMutation({ ...base, issueNumber: 85, labels: ["factory:completed"], mode: "addLabels" }), false);
  assert.equal(allowsFactoryLabelMutation({ ...base, issueNumber: 84, labels: ["factory:completed", "factory:failed"], mode: "addLabels" }), false);
  assert.equal(allowsFactoryLabelMutation({ ...base, issueNumber: 84, labels: ["factory:running"], mode: "removeLabel" }), true);
  assert.equal(allowsFactoryLabelMutation({ ...base, issueNumber: 84, labels: ["factory:completed"], mode: "removeLabel" }), false);
});
