export const FALLBACK_BOT_NAME = "Computer";

export async function resolveBotName(): Promise<string> {
  const name = process.env.FACTORY_BOT_NAME ?? process.env.GITHUB_APP_SLUG;
  return name?.trim() || FALLBACK_BOT_NAME;
}

export function mentionPattern(botName: string): RegExp {
  const escaped = botName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`@${escaped}(?=$|[^A-Za-z0-9_-])`, "iu");
}
