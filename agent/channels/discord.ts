import { discordChannel } from "eve/channels/discord";
import { discordPolicyConfigFromEnv, resolveDiscordAccess } from "../../lib/discord-policy";

/**
 * Controlled Discord channel for Computer.
 *
 * Admission is default-deny and fail-closed: the interaction dispatches only
 * when lib/discord-policy resolves a tier from the full request context
 * (guild, channel, user, roles). Public and internal tiers use distinct
 * principal ids, so sessions and context never cross tiers. Internal replies
 * are ephemeral so internal context does not linger in a shared channel.
 *
 * Credentials come from deployment secrets only (DISCORD_APPLICATION_ID,
 * DISCORD_BOT_TOKEN, DISCORD_PUBLIC_KEY, or Vercel Connect when the operator
 * runs the guided setup). Nothing here reads or stores a secret. The channel
 * stays silent wherever no allowlist matches, including DMs.
 */
export default discordChannel({
  onCommand: (_ctx, interaction) => {
    const access = resolveDiscordAccess(
      {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        memberRoleIds: interaction.member?.roles ?? [],
      },
      discordPolicyConfigFromEnv(),
    );
    if (!access) return null;
    return {
      ephemeral: access.tier === "internal",
      auth: {
        principalId: access.principalId,
        principalType: "user",
        authenticator: "discord",
        attributes: {
          tier: access.tier,
          user_id: interaction.user.id,
          channel_id: interaction.channelId,
          guild_id: interaction.guildId ?? "",
          roles: interaction.member?.roles ?? [],
        },
      },
      context: [`tier: ${access.tier}`],
    };
  },
});
