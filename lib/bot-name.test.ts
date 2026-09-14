import assert from "node:assert/strict";
import test from "node:test";
import {
  bodyMentionsAny,
  bodyMentionsBot,
  resolveInvocationNames,
} from "../agent/lib/github/bot-name.ts";

test("body mention matching is case-insensitive and accepts GitHub bot suffixes", () => {
  assert.equal(bodyMentionsBot("Please ask @WazooComputer to help", "wazoocomputer"), true);
  assert.equal(bodyMentionsBot("Please ask @wazoocomputer[bot] to help", "wazoocomputer"), true);
  assert.equal(bodyMentionsBot("Please ask @wazoocomputerish to help", "wazoocomputer"), false);
});

test("body mention matching ignores non-string bodies", () => {
  assert.equal(bodyMentionsBot(null, "wazoocomputer"), false);
  assert.equal(bodyMentionsBot({ body: "@wazoocomputer" }, "wazoocomputer"), false);
});

test("team alias matches native organization team mention syntax", () => {
  assert.equal(
    bodyMentionsAny("Please ask @wazootech/computer to help", ["wazoocomputer", "wazootech/computer"]),
    true
  );
  assert.equal(
    bodyMentionsAny("Please ask @wazootech/computerish to help", ["wazoocomputer", "wazootech/computer"]),
    false
  );
});

test("invocation names include the configured bot and team alias", async () => {
  const previousBotName = process.env.GITHUB_APP_SLUG;
  const previousTeamMention = process.env.COMPUTER_TEAM_MENTION;
  process.env.GITHUB_APP_SLUG = "wazoocomputer";
  process.env.COMPUTER_TEAM_MENTION = "wazootech/computer";
  try {
    assert.deepEqual(await resolveInvocationNames(), ["wazoocomputer", "wazootech/computer"]);
  } finally {
    if (previousBotName === undefined) delete process.env.GITHUB_APP_SLUG;
    else process.env.GITHUB_APP_SLUG = previousBotName;
    if (previousTeamMention === undefined) delete process.env.COMPUTER_TEAM_MENTION;
    else process.env.COMPUTER_TEAM_MENTION = previousTeamMention;
  }
});
