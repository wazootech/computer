import { type ChannelFrom, defineChannel, POST } from "eve/channels";
import {
  DISCORD_EPHEMERAL_MESSAGE_FLAG,
  DISCORD_INTERACTION_RESPONSE_TYPE,
  DISCORD_INTERACTION_TYPE,
  DISCORD_NO_MENTIONS,
  buildFreeformModalResponse,
  deriveComponentInputResponses,
  deriveModalInputResponses,
  isDiscordFreeformComponent,
  parseDiscordInteraction,
  renderInputRequestComponents,
  sendDiscordChannelMessage,
  splitDiscordMessageContent,
  triggerDiscordTypingIndicator,
} from "eve/channels/discord";
import {
  DISCORD_BRIDGE_MAX_BODY_LENGTH,
  DISCORD_BRIDGE_SIGNATURE_HEADER,
  DISCORD_BRIDGE_TIMESTAMP_HEADER,
  createDedupeCache,
  verifyDiscordBridgeRequest,
} from "../../lib/discord-bridge.ts";
import { discordPolicyConfigFromEnv } from "../../lib/discord-policy.ts";
import {
  type DiscordMentionAdmission,
  discordMentionSessionToken,
  readDiscordMentionEvent,
  resolveDiscordMentionAdmission,
} from "../../lib/discord-mention-policy.ts";

/**
 * Ordinary `@Computer` mentions for the internal Discord channel.
 *
 * Discord delivers ordinary messages over its Gateway websocket, never to an
 * application's HTTP interactions endpoint, so eve's native Discord channel
 * cannot receive them. `bridge/discord-gateway/` holds that Gateway connection
 * and forwards admitted messages here, over an HMAC-signed request, as a
 * compact projection of the Discord message. This channel owns the mention
 * session: it is the only address that receives them, and it delivers every
 * reply back to the originating channel or thread.
 *
 * The route lives under the framework's `/eve/v1` prefix because a Next.js host
 * proxies only that prefix to the eve service, which is also where eve's own
 * platform channels mount (`/eve/v1/discord`, `/eve/v1/github`).
 *
 * Trust boundary: the bridge is authenticated by the shared secret, and every
 * message is still re-admitted here from the projection using this deployment's
 * own allowlists. A forged or stale forward is rejected by the signature; an
 * admitted forward still has to pass the mention, scope, self-loop, and rate
 * checks below. Message text is untrusted input and never changes scope.
 */

/** Session adapter state for one Discord channel or thread. */
interface DiscordMentionState {
  readonly channelId: string;
  readonly guildId: string | null;
  readonly messageId: string;
  readonly parentChannelId: string | null;
}

/** Channel-owned context handed to event handlers. */
interface DiscordMentionContext {
  readonly state: DiscordMentionState;
}

type DiscordMentionSession = ReturnType<ChannelFrom<DiscordMentionState>>;

const INITIAL_STATE: DiscordMentionState = {
  channelId: "",
  guildId: null,
  messageId: "",
  parentChannelId: null,
};

// Parsed once at module load: discordPolicyConfigFromEnv is fail-fast, so a
// tier-overlap misconfiguration crashes the deployment instead of leaking
// internal context into a public channel at request time.
const policyConfig = discordPolicyConfigFromEnv();

// The eve runtime may serve the route from more than one instance, so this is a
// best-effort guard against a Gateway resume replaying a message; the bridge
// keeps its own cache and only single-instance deployments share this state.
const forwardedMessages = createDedupeCache({ limit: 2_000, ttlMs: 30 * 60 * 1000 });

/** Reads the request body, rejecting anything above the bridge cap. */
async function readBody(request: Request): Promise<string | null> {
  const text = await request.text();
  return text.length > DISCORD_BRIDGE_MAX_BODY_LENGTH ? null : text;
}

/**
 * The model-visible context block for one admitted mention.
 *
 * Mirrors eve's own `<discord_context>` block and adds the thread's parent
 * channel, so a mention inside a thread keeps the parent conversation in view.
 */
function contextBlock(admission: DiscordMentionAdmission): string {
  return [
    "<discord_context>",
    "response_medium: discord",
    "response_instructions: Reply for Discord in concise Markdown. Avoid mass mentions, long tables, and messages that need more than a few short posts.",
    `message_trigger: explicit @mention`,
    `user_id: ${admission.authorId}`,
    ...(admission.authorUsername === null ? [] : [`username: ${admission.authorUsername}`]),
    `channel_id: ${admission.sessionChannelId}`,
    ...(admission.parentChannelId === null ? [] : [`parent_channel_id: ${admission.parentChannelId}`]),
    ...(admission.guildId === null ? [] : [`guild_id: ${admission.guildId}`]),
    `message_id: ${admission.messageId}`,
    "</discord_context>",
  ].join("\n");
}

/** Posts one message to the session channel or thread, split to Discord's cap. */
async function postToSession(state: DiscordMentionState, content: string): Promise<void> {
  if (state.channelId.length === 0 || content.trim().length === 0) return;
  for (const chunk of splitDiscordMessageContent(content)) {
    await sendDiscordChannelMessage({
      body: { allowed_mentions: DISCORD_NO_MENTIONS, content: chunk },
      channelId: state.channelId,
    });
  }
}

/** Best-effort delivery: a Discord failure must not fail the turn. */
async function tryPost(state: DiscordMentionState, content: string): Promise<void> {
  try {
    await postToSession(state, content);
  } catch (error) {
    console.error("discord mention delivery failed", { error });
  }
}

/** Best-effort typing indicator. */
async function tryTyping(state: DiscordMentionState): Promise<void> {
  if (state.channelId.length === 0) return;
  try {
    await triggerDiscordTypingIndicator({ channelId: state.channelId });
  } catch {
    console.error("discord mention typing indicator failed");
  }
}

function ignored(reason: string): Response {
  return Response.json({ dispatched: false, ok: true, reason }, { status: 202 });
}

/** Forwards one admitted mention into its channel-scoped session. */
async function dispatchMention(from: ChannelFrom<DiscordMentionState>, payload: unknown): Promise<Response> {
  if (typeof payload !== "object" || payload === null) return ignored("malformed-payload");
  const forwarded = payload as { botUserId?: unknown; event?: unknown };
  // The bot's own user id comes from the bridge's authenticated Gateway
  // identity, never from message text, so mention detection cannot be spoofed
  // by a message that describes the bot.
  const botUserId = typeof forwarded.botUserId === "string" ? forwarded.botUserId : "";
  if (botUserId.length === 0) return ignored("missing-bot-identity");

  const event = readDiscordMentionEvent(forwarded.event);
  if (event === null) return ignored("unreadable-message");
  if (!forwardedMessages.firstSighting(event.messageId, Date.now())) return ignored("duplicate");

  const admission = resolveDiscordMentionAdmission(event, policyConfig, { botUserId });
  if (admission === null) return ignored("denied");

  const session = await from(admission.sessionToken).send(admission.prompt, {
    auth: {
      attributes: {
        channel_id: admission.sessionChannelId,
        guild_id: admission.guildId ?? "",
        message_id: admission.messageId,
        tier: admission.tier,
        user_id: admission.authorId,
      },
      authenticator: "discord-mention",
      issuer: admission.guildId === null ? "discord" : `discord:${admission.guildId}`,
      principalId: admission.principalId,
      principalType: "user",
    },
    context: [contextBlock(admission)],
    state: {
      channelId: admission.sessionChannelId,
      guildId: admission.guildId,
      messageId: admission.messageId,
      parentChannelId: admission.parentChannelId,
    },
    title: `Discord mention in ${admission.sessionChannelId}`,
  });

  return Response.json({ dispatched: true, ok: true, sessionId: session.id }, { status: 202 });
}

/**
 * Answers one approval component or modal submission.
 *
 * The interaction is acknowledged by the bridge with the callback returned here,
 * exactly as eve's native Discord channel answers its own components. Input
 * responses are the only thing that crosses into the parked session, so a click
 * that carries no eve HITL id changes nothing.
 */
async function dispatchInteraction(from: ChannelFrom<DiscordMentionState>, payload: unknown): Promise<Response> {
  if (typeof payload !== "object" || payload === null) return ignored("malformed-payload");
  const interaction = parseDiscordInteraction((payload as { interaction?: unknown }).interaction);
  if (interaction === null) return ignored("unsupported-interaction");
  if (interaction.type === DISCORD_INTERACTION_TYPE.APPLICATION_COMMAND) {
    return ignored("retired-slash-command");
  }

  const session: DiscordMentionSession = from(
    discordMentionSessionToken({ channelId: interaction.channelId, guildId: interaction.guildId ?? null }),
  );

  if (interaction.type === DISCORD_INTERACTION_TYPE.MESSAGE_COMPONENT) {
    if (isDiscordFreeformComponent(interaction.customId)) {
      return Response.json({
        callback: buildFreeformModalResponse({
          customId: interaction.customId,
          prompt: readMessageContent(interaction.raw),
        }),
        ok: true,
      });
    }
    const inputResponses = deriveComponentInputResponses(interaction);
    if (inputResponses.length === 0) return ignored("unknown-component");
    // eve's own Discord channel answers components with a null auth context;
    // resuming never creates a session or re-authorizes the initiator.
    await session.respond(inputResponses, { auth: null });
    return Response.json({
      callback: { type: DISCORD_INTERACTION_RESPONSE_TYPE.DEFERRED_UPDATE_MESSAGE },
      ok: true,
    });
  }

  const inputResponses = deriveModalInputResponses(interaction);
  if (inputResponses.length === 0) return ignored("unknown-modal");
  await session.respond(inputResponses, { auth: null });
  return Response.json({
    callback: {
      data: { content: "Answer received.", flags: DISCORD_EPHEMERAL_MESSAGE_FLAG },
      type: DISCORD_INTERACTION_RESPONSE_TYPE.CHANNEL_MESSAGE_WITH_SOURCE,
    },
    ok: true,
  });
}

/** The prompt shown above a freeform answer button, read from the component message. */
function readMessageContent(raw: Record<string, unknown>): string | undefined {
  const message = raw.message;
  if (typeof message !== "object" || message === null) return undefined;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" && content.trim().length > 0 ? content : undefined;
}

export default defineChannel<DiscordMentionState, DiscordMentionContext>({
  context(state) {
    return { state };
  },
  events: {
    async "actions.requested"(_data, channel) {
      await tryTyping(channel.state);
    },
    async "input.requested"(data, channel) {
      for (const request of data.requests) {
        const components = renderInputRequestComponents(request);
        if (components.length === 0) continue;
        try {
          await sendDiscordChannelMessage({
            body: {
              allowed_mentions: DISCORD_NO_MENTIONS,
              components,
              content: splitDiscordMessageContent(request.prompt)[0] ?? "",
            },
            channelId: channel.state.channelId,
          });
        } catch (error) {
          console.error("discord mention input request failed", { error });
        }
      }
    },
    async "message.completed"(data, channel) {
      if (data.finishReason === "tool-calls") return;
      if (typeof data.message !== "string" || data.message.length === 0) return;
      await tryPost(channel.state, data.message);
    },
    async "session.failed"(_data, channel) {
      await tryPost(channel.state, "Computer could not recover from an error on that request. Please try again.");
    },
    async "turn.failed"(_data, channel) {
      await tryPost(channel.state, "Computer hit an error handling that request. Please try again or rephrase it.");
    },
    async "turn.started"(_data, channel) {
      await tryTyping(channel.state);
    },
  },
  metadata(state) {
    return {
      audience: "private" as const,
      channel_id: state.channelId,
      guild_id: state.guildId ?? "",
    };
  },
  routes: [
    POST("/eve/v1/discord-mentions", async (request, { from }) => {
      const body = await readBody(request);
      if (body === null) return Response.json({ error: "payload-too-large" }, { status: 413 });

      const verified = verifyDiscordBridgeRequest({
        body,
        nowMs: Date.now(),
        secret: process.env.DISCORD_BRIDGE_SECRET ?? "",
        signature: request.headers.get(DISCORD_BRIDGE_SIGNATURE_HEADER),
        timestamp: request.headers.get(DISCORD_BRIDGE_TIMESTAMP_HEADER),
      });
      if (!verified) return Response.json({ error: "unauthorized" }, { status: 401 });

      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        return Response.json({ error: "invalid-json" }, { status: 400 });
      }

      const kind = (payload as { kind?: unknown } | null)?.kind;
      if (kind === "interaction") return dispatchInteraction(from, payload);
      if (kind === "message") return dispatchMention(from, payload);
      return Response.json({ error: "unsupported-kind" }, { status: 400 });
    }),
  ],
  state: INITIAL_STATE,
  turnPolicy: "queue",
});
