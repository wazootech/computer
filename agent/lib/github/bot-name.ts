export const FALLBACK_BOT_NAME = "Computer";
export const DEFAULT_TEAM_MENTION = "wazootech/computer";

export async function resolveTeamMention(): Promise<string> {
  return process.env.COMPUTER_TEAM_MENTION?.trim() || DEFAULT_TEAM_MENTION;
}

export async function resolveBotName(): Promise<string> {
  const name = process.env.FACTORY_BOT_NAME ?? process.env.GITHUB_APP_SLUG;
  return name?.trim() || FALLBACK_BOT_NAME;
}

export async function resolveInvocationNames(): Promise<string[]> {
  return [...new Set([await resolveBotName(), await resolveTeamMention()])];
}

export function mentionPattern(botName: string): RegExp {
  const escaped = botName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`@${escaped}(?=$|[^A-Za-z0-9_-])`, "iu");
}

export function bodyMentionsBot(body: unknown, botName: string): boolean {
  return typeof body === "string" && mentionPattern(botName).test(body);
}

export function bodyMentionsAny(body: unknown, names: readonly string[]): boolean {
  return names.some((name) => bodyMentionsBot(body, name));
}
