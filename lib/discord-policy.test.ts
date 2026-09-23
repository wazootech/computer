import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discordPolicyConfigFromEnv, parseIdList, resolveDiscordAccess } from "./discord-policy.ts";

const config = {
  publicGuildIds: ["guild-public"],
  publicChannelIds: ["chan-support"],
  internalGuildIds: ["guild-internal"],
  internalChannelIds: ["chan-team", "chan-eng"],
  internalUserIds: ["user-alice"],
  internalRoleIds: ["role-wazoo-team"],
};

describe("parseIdList", () => {
  it("returns empty arrays for unset and blank input", () => {
    assert.deepEqual(parseIdList(undefined), []);
    assert.deepEqual(parseIdList(""), []);
    assert.deepEqual(parseIdList("  "), []);
  });

  it("trims entries and drops empties", () => {
    assert.deepEqual(parseIdList(" a , b,,c "), ["a", "b", "c"]);
  });
});

describe("resolveDiscordAccess", () => {
  const base = { userId: "user-unknown", memberRoleIds: [] as string[] };

  it("denies DMs (no guild)", () => {
    assert.equal(resolveDiscordAccess({ ...base, channelId: "chan-support" }, config), null);
    assert.equal(resolveDiscordAccess({ ...base, channelId: "chan-team" }, config), null);
  });

  it("denies unlisted channels", () => {
    assert.equal(resolveDiscordAccess({ ...base, guildId: "guild-public", channelId: "chan-random" }, config), null);
  });

  it("admits the public tier only in allowlisted public channels of the public guild", () => {
    assert.deepEqual(resolveDiscordAccess({ ...base, guildId: "guild-public", channelId: "chan-support" }, config), {
      tier: "public",
      principalId: "discord-public:user-unknown",
    });
  });

  it("fails closed when the channel matches but the guild does not", () => {
    assert.equal(resolveDiscordAccess({ ...base, guildId: "guild-other", channelId: "chan-support" }, config), null);
  });

  it("admits the internal tier for an allowlisted user in an allowlisted internal channel", () => {
    assert.deepEqual(
      resolveDiscordAccess(
        { guildId: "guild-internal", channelId: "chan-team", userId: "user-alice", memberRoleIds: [] },
        config,
      ),
      { tier: "internal", principalId: "discord-team:user-alice" },
    );
  });

  it("admits the internal tier for an allowlisted role even for an unknown user", () => {
    assert.deepEqual(
      resolveDiscordAccess(
        { guildId: "guild-internal", channelId: "chan-eng", userId: "user-stranger", memberRoleIds: ["role-wazoo-team"] },
        config,
      ),
      { tier: "internal", principalId: "discord-team:user-stranger" },
    );
  });

  it("denies an internal channel when neither user nor roles are allowlisted", () => {
    assert.equal(
      resolveDiscordAccess(
        { guildId: "guild-internal", channelId: "chan-team", userId: "user-stranger", memberRoleIds: ["role-other"] },
        config,
      ),
      null,
    );
  });

  it("denies an internal channel when the guild is not the internal guild", () => {
    assert.equal(
      resolveDiscordAccess(
        { guildId: "guild-public", channelId: "chan-team", userId: "user-alice", memberRoleIds: ["role-wazoo-team"] },
        config,
      ),
      null,
    );
  });

  it("never admits the public tier through an internal allowlist entry", () => {
    const access = resolveDiscordAccess(
      { guildId: "guild-internal", channelId: "chan-team", userId: "user-stranger", memberRoleIds: [] },
      config,
    );
    assert.equal(access, null);
  });

  it("resolves a tier overlap deterministically: public wins when a channel id is in both allowlists", () => {
    // Unreachable through the environment (discordPolicyConfigFromEnv rejects
    // overlap), but the tie-break stays contractual for hand-built configs:
    // the public tier is the fail-safe, read-only direction.
    const overlapping = { ...config, publicChannelIds: ["chan-support", "chan-team"] };
    assert.deepEqual(resolveDiscordAccess({ ...base, guildId: "guild-public", channelId: "chan-team" }, overlapping), {
      tier: "public",
      principalId: "discord-public:user-unknown",
    });
  });
});

describe("discordPolicyConfigFromEnv", () => {
  it("reads the six allowlists and the guild-wide flag from the environment", () => {
    const parsed = discordPolicyConfigFromEnv({
      NODE_ENV: "development",
      DISCORD_PUBLIC_GUILD_IDS: "g1",
      DISCORD_PUBLIC_CHANNEL_IDS: "c1, c2",
      DISCORD_INTERNAL_GUILD_IDS: "",
      DISCORD_INTERNAL_CHANNEL_IDS: "c3",
      DISCORD_INTERNAL_USER_IDS: "u1",
      DISCORD_INTERNAL_ROLE_IDS: "r1,r2",
    });
    assert.deepEqual(parsed, {
      publicGuildIds: ["g1"],
      publicChannelIds: ["c1", "c2"],
      internalGuildIds: [],
      internalChannelIds: ["c3"],
      internalUserIds: ["u1"],
      internalRoleIds: ["r1", "r2"],
      internalGuildWide: false,
    });
  });

  it("turns guild-wide admission on only for an explicit truthy flag", () => {
    const base = { NODE_ENV: "development" as const, DISCORD_INTERNAL_GUILD_IDS: "g1", DISCORD_INTERNAL_ROLE_IDS: "r1" };
    for (const on of ["1", "true", "TRUE", " true "]) {
      assert.equal(discordPolicyConfigFromEnv({ ...base, DISCORD_INTERNAL_GUILD_WIDE: on }).internalGuildWide, true);
    }
    for (const off of [undefined, "", "0", "false", "no", "on", "yes", "banana"]) {
      assert.equal(discordPolicyConfigFromEnv({ ...base, DISCORD_INTERNAL_GUILD_WIDE: off }).internalGuildWide, false);
    }
  });
});
