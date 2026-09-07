import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_NODE_POLICY, FACTORY_NETWORK_POLICY, checkCommands } from "./sandbox-policy.ts";

describe("checkCommands", () => {
  it("flattens the default phases in order", () => {
    assert.deepEqual(checkCommands(), ["pnpm format:check", "pnpm typecheck", "pnpm test"]);
  });

  it("carries the factory repair rule and time budgets", () => {
    assert.equal(DEFAULT_NODE_POLICY.maxRepairAttempts, 1);
    assert.equal(DEFAULT_NODE_POLICY.commandTimeoutMs, 300_000);
    assert.equal(DEFAULT_NODE_POLICY.phaseTimeoutMs, 600_000);
  });
});

describe("FACTORY_NETWORK_POLICY", () => {
  it("allow-lists npm and never github.com", () => {
    const allow = FACTORY_NETWORK_POLICY.allow as readonly string[];
    assert.ok(allow.includes("*.npmjs.org"));
    assert.ok(!allow.some((d) => d.includes("github.com")));
  });
});
