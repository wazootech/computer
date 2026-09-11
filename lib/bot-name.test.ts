import assert from "node:assert/strict";
import test from "node:test";
import { bodyMentionsBot } from "../agent/lib/github/bot-name.ts";

test("body mention matching is case-insensitive and accepts GitHub bot suffixes", () => {
  assert.equal(bodyMentionsBot("Please ask @WazooComputer to help", "wazoocomputer"), true);
  assert.equal(bodyMentionsBot("Please ask @wazoocomputer[bot] to help", "wazoocomputer"), true);
  assert.equal(bodyMentionsBot("Please ask @wazoocomputerish to help", "wazoocomputer"), false);
});

test("body mention matching ignores non-string bodies", () => {
  assert.equal(bodyMentionsBot(null, "wazoocomputer"), false);
  assert.equal(bodyMentionsBot({ body: "@wazoocomputer" }, "wazoocomputer"), false);
});
