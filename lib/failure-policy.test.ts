import assert from "node:assert/strict";
import test from "node:test";
import {
  describeFailure,
  failureCommentBody,
  isDeploymentFault,
} from "./failure-policy.ts";

/**
 * The payload eve attached on the 2026-09-21 dispatches that took Computer
 * offline: a revoked DeepSeek key, surfaced as a provider rejection with the
 * provider's own message in the event.
 */
const revokedKeyFailure = {
  code: "turn_failed",
  details: {
    errorId: "5f2c1d0e-9a3b-4c7d-8e1f-2b3c4d5e6f70",
    name: "Model provider API error",
    statusCode: 401,
    upstreamType: "authentication_error",
  },
  message: "Model provider API error: Authentication Fails, Your api key: ****53a6 is invalid",
};

test("suppresses the provider rejection that takes the deployment offline", () => {
  assert.equal(isDeploymentFault(revokedKeyFailure), true);
  assert.equal(failureCommentBody(revokedKeyFailure), null);
});

test("suppresses a gateway rejection of a model the account cannot reach", () => {
  const failure = {
    code: "turn_failed",
    details: {
      name: "AI Gateway model request rejected",
      statusCode: 403,
      upstreamType: "model_not_found",
    },
    message: "AI Gateway rejected the model request before the agent produced a response.",
  };
  assert.equal(isDeploymentFault(failure), true);
  assert.equal(failureCommentBody(failure), null);
});

test("treats a bare credential status code as a deployment fault", () => {
  const failure = {
    code: "session_failed",
    details: { statusCode: 402 },
    message: "upstream request failed",
  };
  assert.equal(isDeploymentFault(failure), true);
  assert.equal(failureCommentBody(failure), null);
});

test("treats a rejection named only inside the message as a deployment fault", () => {
  const failure = {
    code: "turn_failed",
    details: {},
    message: "Model provider API error: Authentication Fails, Your api key is invalid",
  };
  assert.equal(isDeploymentFault(failure), true);
  assert.equal(failureCommentBody(failure), null);
});

test("still answers an ordinary failure, with the correlation id and no provider text", () => {
  const failure = {
    code: "turn_failed",
    details: { errorId: "9d1b2c3a-4e5f-4061-8273-8495a6b7c8d9", statusCode: 400 },
    message: "Tool input did not match the declared schema",
  };
  const body = failureCommentBody(failure);
  assert.ok(body !== null);
  assert.match(body, /could not recover/u);
  assert.match(body, /Error id: 9d1b2c3a-4e5f-4061-8273-8495a6b7c8d9/u);
  assert.doesNotMatch(body, /Tool input did not match the declared schema/u);
});

test("answers an ordinary failure that carries no correlation id", () => {
  const failure = { code: "turn_failed", details: {}, message: "sandbox checkout timed out" };
  const body = failureCommentBody(failure);
  assert.ok(body !== null);
  assert.doesNotMatch(body, /Error id/u);
  assert.doesNotMatch(body, /sandbox checkout timed out/u);
});

test("describes a failure from structured fields only", () => {
  const description = describeFailure(revokedKeyFailure);
  assert.equal(
    description,
    "turn_failed | Model provider API error | upstream authentication_error | HTTP 401 | error id 5f2c1d0e-9a3b-4c7d-8e1f-2b3c4d5e6f70",
  );
  assert.doesNotMatch(description, /\*\*\*53a6/u);
});

test("survives a failure with no details at all", () => {
  const failure = { code: "session_failed", message: "" };
  assert.equal(isDeploymentFault(failure), false);
  assert.ok(failureCommentBody(failure) !== null);
  assert.equal(describeFailure(failure), "session_failed");
});
