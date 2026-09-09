import assert from "node:assert/strict";
import test from "node:test";
import { redact } from "../agent/lib/redaction.ts";

test("redacts credential-shaped object keys", () => {
  const value = redact({
    apiKey: "sk-secret",
    nested: { authorization: "Bearer token" },
    summary: "safe result",
  });
  assert.deepEqual(value, {
    apiKey: "[REDACTED]",
    nested: { authorization: "[REDACTED]" },
    summary: "safe result",
  });
});

test("redacts credential-shaped text", () => {
  const value = redact("Authorization: Bearer abc123 GITHUB_WEBHOOK_SECRET=secret");
  assert.equal(value, "Authorization: Bearer [REDACTED] GITHUB_WEBHOOK_SECRET=[REDACTED]");
});

