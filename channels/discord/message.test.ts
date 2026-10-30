import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Message } from "discord.js";
import { discordJsMentionEvent } from "./message.ts";

function messageFixture(overrides: Record<string, unknown> = {}): Message {
  return {
    author: { bot: false, id: "user-alice", username: "alice" },
    channel: { isThread: () => false, parentId: null },
    channelId: "chan-team",
    content: "<@900000000000000001> status",
    guildId: "guild-internal",
    id: "msg-1",
    inGuild: () => true,
    member: { roles: { cache: { map: (callback: (role: { id: string }) => string) => [{ id: "role-staff" }].map(callback) } } },
    type: 0,
    webhookId: null,
    ...overrides,
  } as unknown as Message;
}

describe("discord.js message adapter", () => {
  it("normalizes guild messages and their cached member roles", () => {
    assert.deepEqual(discordJsMentionEvent(messageFixture()), {
      author: { id: "user-alice", bot: false, webhook: false },
      authorUsername: "alice",
      channelId: "chan-team",
      content: "<@900000000000000001> status",
      guildId: "guild-internal",
      memberRoleIds: ["role-staff"],
      messageId: "msg-1",
      messageType: 0,
      parentChannelId: null,
    });
  });

  it("retains a thread parent for allowlist admission", () => {
    const message = messageFixture({
      channel: { isThread: () => true, parentId: "chan-team" },
      channelId: "thread-7",
    });
    assert.equal(discordJsMentionEvent(message)?.parentChannelId, "chan-team");
  });

  it("rejects direct messages before policy evaluation", () => {
    assert.equal(discordJsMentionEvent(messageFixture({ inGuild: () => false })), null);
  });

  it("marks webhook-authored messages so admission can reject them", () => {
    assert.equal(
      discordJsMentionEvent(messageFixture({ webhookId: "webhook-1" }))?.author.webhook,
      true,
    );
  });
});
