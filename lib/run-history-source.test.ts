import assert from "node:assert/strict";
import test from "node:test";
import { hasGithubCorrelation, sourceFromAuth } from "../agent/lib/run-history-source.ts";

test("extracts GitHub source correlation from stamped auth", () => {
  const source = sourceFromAuth({
    current: {
      attributes: {
        githubDeliveryId: "delivery-123",
        githubEvent: "issues.labeled",
        githubIssueNumber: "84",
        githubPullRequestNumber: "91",
        githubSourceType: "factory",
      },
    },
  }, "github");
  assert.deepEqual(source, {
    channel: "github",
    deliveryId: "delivery-123",
    event: "issues.labeled",
    issueNumber: 84,
    pullRequestNumber: 91,
    type: "factory",
  });
  assert.equal(hasGithubCorrelation(source), true);
});

test("diagnoses incomplete GitHub correlation instead of treating it as complete", () => {
  assert.equal(hasGithubCorrelation(sourceFromAuth({ current: { attributes: { githubEvent: "issues.opened" } } }, "github")), false);
  assert.equal(hasGithubCorrelation(sourceFromAuth({}, "web")), true);
});
