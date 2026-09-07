/**
 * Admission policy for Computer's Discord channel: two policy tiers with
 * default-deny, fail-closed semantics.
 *
 * Pure and dependency-free so the admission matrix is directly testable. The
 * channel layer (agent/channels/discord.ts) maps the resolved tier onto the
 * eve session auth context; no tier decision lives there.
 */

export type DiscordTier = "public" | "internal";

export interface DiscordAccessRequest {
  /** Discord guild (server) id, undefined in DMs. */
  readonly guildId?: string;
  readonly channelId: string;
  readonly userId: string;
  readonly memberRoleIds: readonly string[];
}

export interface DiscordPolicyConfig {
  readonly publicGuildIds: readonly string[];
  readonly publicChannelIds: readonly string[];
  readonly internalGuildIds: readonly string[];
  readonly internalChannelIds: readonly string[];
  readonly internalUserIds: readonly string[];
  readonly internalRoleIds: readonly string[];
}

export type DiscordAccess =
  | { readonly tier: DiscordTier; readonly principalId: string }
  | null;

/** Parse a comma-separated id list from the environment. Empty and unset are []. */
export function parseIdList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

export function discordPolicyConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DiscordPolicyConfig {
  return {
    publicGuildIds: parseIdList(env.DISCORD_PUBLIC_GUILD_IDS),
    publicChannelIds: parseIdList(env.DISCORD_PUBLIC_CHANNEL_IDS),
    internalGuildIds: parseIdList(env.DISCORD_INTERNAL_GUILD_IDS),
    internalChannelIds: parseIdList(env.DISCORD_INTERNAL_CHANNEL_IDS),
    internalUserIds: parseIdList(env.DISCORD_INTERNAL_USER_IDS),
    internalRoleIds: parseIdList(env.DISCORD_INTERNAL_ROLE_IDS),
  };
}

function isGuildAllowlisted(guildId: string | undefined, guildIds: readonly string[]): boolean {
  return guildId !== undefined && guildIds.includes(guildId);
}

/**
 * Resolve the policy tier for one interaction, or null when the interaction
 * must not dispatch. Default deny:
 *
 * - Public tier: guild and channel both on the public allowlist. Read-only
 *   with respect to Wazoo systems and public-safe knowledge only.
 * - Internal tier: guild and channel on the internal allowlist AND the user
 *   id or at least one role on the internal operator lists. Neither the
 *   channel alone nor a role alone grants access.
 *
 * The returned principal ids differ per tier, so public and internal sessions
 * never share a principal, and every emitted attribute set carries its tier.
 */
export function resolveDiscordAccess(
  request: DiscordAccessRequest,
  config: DiscordPolicyConfig,
): DiscordAccess {
  if (
    isGuildAllowlisted(request.guildId, config.publicGuildIds) &&
    config.publicChannelIds.includes(request.channelId)
  ) {
    return { tier: "public", principalId: `discord-public:${request.userId}` };
  }

  const userAllowed = config.internalUserIds.includes(request.userId);
  const roleAllowed = request.memberRoleIds.some((roleId) => config.internalRoleIds.includes(roleId));
  if (
    isGuildAllowlisted(request.guildId, config.internalGuildIds) &&
    config.internalChannelIds.includes(request.channelId) &&
    (userAllowed || roleAllowed)
  ) {
    return { tier: "internal", principalId: `discord-team:${request.userId}` };
  }

  return null;
}
