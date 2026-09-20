/**
 * Admission policy for ordinary Discord `@Computer` mentions in the internal
 * channel.
 *
 * Discord delivers ordinary messages over the Gateway, not to an interactions
 * endpoint, so mention admission lives in its own policy module beside
 * {@link ./discord-policy.ts}, which continues to own the guild/channel/user/
 * role tier resolution.
 *
 * Pure and dependency-free, so the admission matrix, mention parsing, session
 * mapping, self-loop prevention, and hostile-input handling are directly
 * testable. Both the Gateway bridge and the agent's ingress route run this
 * policy: the bridge uses it to drop obvious noise early, and the ingress route
 * re-runs it on the bridge's payload so the deployment, not the transport,
 * makes the decision.
 */

import { type DiscordPolicyConfig, resolveDiscordAccess } from "./discord-policy.ts";
import { withDiscordControlCharactersStripped } from "./discord-text.ts";

/** Component that owns the bot trigger, used to reject self-authored mentions. */
export interface DiscordMentionAuthor {
  readonly id: string;
  readonly bot: boolean;
  /** Discord sets this on messages created by an incoming webhook. */
  readonly webhook: boolean;
}

/** One normalized Discord message, as the admission policy needs it. */
export interface DiscordMentionEvent {
  readonly author: DiscordMentionAuthor;
  /** Discord author username, for the model-visible context block. */
  readonly authorUsername: string | null;
  readonly channelId: string;
  /** Message content, verbatim. */
  readonly content: string;
  readonly guildId: string | null;
  readonly memberRoleIds: readonly string[];
  readonly messageId: string;
  /** Discord message type. Only ordinary, reply, and thread-starter messages are admitted. */
  readonly messageType: number;
  /**
   * Parent channel of the thread the message arrived in, or null for a plain
   * channel message. Admission treats a thread as belonging to its parent
   * channel; the session stays keyed to the thread.
   */
  readonly parentChannelId: string | null;
}

/** Admitted internal mention, ready to become one agent turn. */
export interface DiscordMentionAdmission {
  readonly authorId: string;
  readonly authorUsername: string | null;
  readonly guildId: string | null;
  readonly messageId: string;
  /** Parent channel id when the mention arrived in a thread, else null. */
  readonly parentChannelId: string | null;
  readonly principalId: string;
  /** Sanitized, mention-stripped prompt. */
  readonly prompt: string;
  /**
   * Channel-local continuation address for this conversation, from
   * {@link discordMentionSessionToken}.
   */
  readonly sessionToken: string;
  /**
   * Discord channel that owns the session: the thread when the mention arrived
   * in one, otherwise the channel itself. Threads therefore never share a
   * session with their parent channel, and one channel never shares with
   * another.
   */
  readonly sessionChannelId: string;
  readonly tier: "internal";
}

export interface DiscordMentionContext {
  /**
   * The Computer bot's own user id, taken from the Gateway's authenticated
   * identity. Never read from message text.
   */
  readonly botUserId: string;
}

/** Discord message types the policy admits: default, reply, and thread starter. */
const ADMITTED_MESSAGE_TYPES = new Set([0, 19, 21]);

/** Prompt cap. Longer message text is truncated rather than dispatched whole. */
export const DISCORD_MENTION_MAX_PROMPT_CHARACTERS = 4_000;

/** Marker appended when a prompt is truncated, so the model knows text was cut. */
const TRUNCATION_MARKER = "\n\n[message truncated]";

/** Built-in Discord mention markup: `<@id>`, `<@!id>`, `<@&roleId>`, `<#channelId>`. */
const MENTION_PATTERN = /<@([!&]?)(\d+)>|<#(\d+)>/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Normalizes one raw Discord `MESSAGE_CREATE` payload into the shape the policy
 * consumes. Returns null when the payload cannot be read as a guild message.
 */
export function readDiscordMentionEvent(raw: unknown): DiscordMentionEvent | null {
  if (!isRecord(raw)) return null;

  const messageId = readNonEmptyString(raw.id);
  const channelId = readNonEmptyString(raw.channel_id);
  const author = isRecord(raw.author) ? raw.author : null;
  const authorId = author === null ? null : readNonEmptyString(author.id);
  if (messageId === null || channelId === null || authorId === null) return null;

  const thread = isRecord(raw.thread) ? raw.thread : null;
  const member = isRecord(raw.member) ? raw.member : null;
  const roles =
    member !== null && Array.isArray(member.roles)
      ? member.roles.filter((role): role is string => typeof role === "string")
      : [];

  return {
    author: {
      bot: author?.bot === true,
      id: authorId,
      webhook: author?.webhook === true || readNonEmptyString(raw.webhook_id) !== null,
    },
    authorUsername: readNonEmptyString(author?.username),
    channelId,
    content: typeof raw.content === "string" ? raw.content : "",
    guildId: readNonEmptyString(raw.guild_id),
    memberRoleIds: roles,
    messageId,
    messageType: typeof raw.type === "number" ? raw.type : 0,
    parentChannelId: thread === null ? null : readNonEmptyString(thread.parent_id),
  };
}

/**
 * Whether the message text contains an explicit mention of the Computer user.
 *
 * Only the user mention forms count. `@everyone`, `@here`, role mentions, and
 * channel links never trigger a turn, and neither does the bot's own name typed
 * as plain text.
 */
export function hasBotMention(content: string, context: DiscordMentionContext): boolean {
  if (context.botUserId.length === 0) return false;
  for (const match of content.matchAll(MENTION_PATTERN)) {
    const [, prefix, userId] = match;
    if (prefix !== undefined && prefix !== "" && prefix !== "!") continue;
    if (userId === context.botUserId) return true;
  }
  return false;
}

/**
 * Strips the bot mention, removes invisible characters, normalizes line endings,
 * and caps the length. Everything that remains is untrusted text: it cannot
 * change the configured scope, permissions, or approval policy, and the agent
 * treats it as a request rather than as instructions.
 */
export function sanitizeMentionPrompt(content: string, context: DiscordMentionContext): string {
  const withoutHiddenCharacters = withDiscordControlCharactersStripped(content);
  const withoutMention = withoutHiddenCharacters.replace(
    MENTION_PATTERN,
    (match, prefix: string | undefined, userId: string | undefined) => {
      const isUserMention = prefix === undefined || prefix === "" || prefix === "!";
      return isUserMention && userId === context.botUserId ? "" : match;
    },
  );

  const normalized = withoutMention.trim();

  return normalized.length > DISCORD_MENTION_MAX_PROMPT_CHARACTERS
    ? `${normalized.slice(0, DISCORD_MENTION_MAX_PROMPT_CHARACTERS)}${TRUNCATION_MARKER}`
    : normalized;
}

/**
 * Resolves admission for one mention, or null when it must not dispatch.
 *
 * Fail closed at every step. A message dispatches only when the author is a
 * person other than the bot, the guild and channel (or the thread's parent
 * channel) are on the internal allowlist, the author id or one of their roles is
 * allowlisted, the text explicitly mentions the bot, and the mention leaves a
 * non-empty prompt.
 *
 * The public tier is not admitted here: customer-service mentions are deferred,
 * so a public-allowlisted channel never starts a mention turn.
 */
export function resolveDiscordMentionAdmission(
  event: DiscordMentionEvent,
  config: DiscordPolicyConfig,
  context: DiscordMentionContext,
): DiscordMentionAdmission | null {
  if (!ADMITTED_MESSAGE_TYPES.has(event.messageType)) return null;
  if (event.author.bot || event.author.webhook) return null;
  if (context.botUserId.length === 0) return null;
  if (event.author.id === context.botUserId) return null;
  if (event.guildId === null) return null;

  // A thread is admitted through its parent channel, so operators allowlist
  // channels rather than every thread a conversation creates.
  const admissionChannelId = event.parentChannelId ?? event.channelId;
  const access = resolveDiscordAccess(
    {
      channelId: admissionChannelId,
      guildId: event.guildId,
      memberRoleIds: event.memberRoleIds,
      userId: event.author.id,
    },
    config,
  );
  if (access === null || access.tier !== "internal") return null;
  if (!hasBotMention(event.content, context)) return null;

  const prompt = sanitizeMentionPrompt(event.content, context);
  if (prompt.length === 0) return null;

  return {
    authorId: event.author.id,
    authorUsername: event.authorUsername,
    guildId: event.guildId,
    messageId: event.messageId,
    parentChannelId: event.parentChannelId,
    principalId: access.principalId,
    prompt,
    sessionChannelId: event.channelId,
    sessionToken: discordMentionSessionToken({ channelId: event.channelId, guildId: event.guildId }),
    tier: "internal",
  };
}

/**
 * Builds the channel-local continuation address that keys one conversation's
 * session. The framework prefixes the channel name, so this token only has to
 * be unique inside this channel.
 */
export function discordMentionSessionToken(input: {
  readonly channelId: string;
  readonly guildId: string | null;
}): string {
  return `${input.guildId ?? "dm"}:${input.channelId}`;
}
