import assert from "node:assert/strict";
import test from "node:test";
import { discordPolicyConfigFromEnv, resolveDiscordAccess } from "./discord-policy.ts";

const GUILD = "guild-1";
const OTHER_GUILD = "guild-2";
const CHANNEL = "channel-1";
const ADMIN_ROLE = "role-admin";
const MEMBER = "user-member";

function config(overrides: Partial<ReturnType<typeof discordPolicyConfigFromEnv>> = {}) {
  return {
    publicGuildIds: [],
    publicChannelIds: [],
    internalGuildIds: [GUILD],
    internalChannelIds: [CHANNEL],
    internalUserIds: [],
    internalRoleIds: [ADMIN_ROLE],
    internalGuildWide: false,
    ...overrides,
  };
}

test("an allowlisted channel with an admin role resolves to the internal tier", () => {
  const access = resolveDiscordAccess(
    { guildId: GUILD, channelId: CHANNEL, userId: MEMBER, memberRoleIds: [ADMIN_ROLE] },
    config(),
  );
  assert.equal(access?.tier, "internal");
});

test("a channel outside the allowlist is denied while guild-wide is off", () => {
  const access = resolveDiscordAccess(
    { guildId: GUILD, channelId: "channel-2", userId: MEMBER, memberRoleIds: [ADMIN_ROLE] },
    config(),
  );
  assert.equal(access, null);
});

test("guild-wide admits an admin mention in any channel of the allowlisted guild", () => {
  const access = resolveDiscordAccess(
    { guildId: GUILD, channelId: "channel-2", userId: MEMBER, memberRoleIds: [ADMIN_ROLE] },
    config({ internalGuildWide: true }),
  );
  assert.equal(access?.tier, "internal");
  assert.equal(access?.principalId, `discord-team:${MEMBER}`);
});

test("guild-wide still requires the guild allowlist", () => {
  const access = resolveDiscordAccess(
    { guildId: OTHER_GUILD, channelId: CHANNEL, userId: MEMBER, memberRoleIds: [ADMIN_ROLE] },
    config({ internalGuildWide: true }),
  );
  assert.equal(access, null);
});

test("guild-wide still requires an allowlisted user or role", () => {
  const access = resolveDiscordAccess(
    { guildId: GUILD, channelId: "channel-2", userId: MEMBER, memberRoleIds: ["role-other"] },
    config({ internalGuildWide: true }),
  );
  assert.equal(access, null);
});

test("guild-wide never admits a DM, where no guild id is present", () => {
  const access = resolveDiscordAccess(
    { guildId: undefined, channelId: "dm-channel", userId: MEMBER, memberRoleIds: [] },
    config({ internalGuildWide: true }),
  );
  assert.equal(access, null);
});

test("guild-wide does not open the public tier", () => {
  const access = resolveDiscordAccess(
    { guildId: GUILD, channelId: CHANNEL, userId: MEMBER, memberRoleIds: [ADMIN_ROLE] },
    config({ internalGuildWide: true, publicGuildIds: [GUILD] }),
  );
  assert.equal(access?.tier, "internal");
});

test("reads the guild-wide switch from the environment, defaulting to off", () => {
  const flag = (raw?: string): boolean =>
    discordPolicyConfigFromEnv({
      NODE_ENV: "test",
      ...(raw === undefined ? {} : { DISCORD_INTERNAL_GUILD_WIDE: raw }),
    }).internalGuildWide ?? false;
  assert.equal(flag(), false);
  assert.equal(flag(""), false);
  assert.equal(flag("0"), false);
  assert.equal(flag("false"), false);
  assert.equal(flag("1"), true);
  assert.equal(flag("true"), true);
});
