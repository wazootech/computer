import type { Message } from "discord.js";
import type { DiscordMentionEvent } from "../../lib/discord-mention-policy.ts";

export function discordJsMentionEvent(message: Message): DiscordMentionEvent | null {
  if (!message.inGuild()) return null;

  return {
    author: {
      id: message.author.id,
      bot: message.author.bot,
      webhook: message.webhookId !== null,
    },
    authorUsername: message.author.username,
    channelId: message.channelId,
    content: message.content,
    guildId: message.guildId,
    memberRoleIds: message.member?.roles.cache.map((role) => role.id) ?? [],
    messageId: message.id,
    messageType: message.type,
    parentChannelId: message.channel.isThread() ? message.channel.parentId : null,
  };
}
