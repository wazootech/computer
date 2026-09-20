#!/usr/bin/env node
/**
 * Discord Gateway bridge for Computer's internal mention channel.
 *
 * Discord sends ordinary `MESSAGE_CREATE` events over the Gateway, never to an
 * interactions endpoint, so mention support needs a socket. Vercel functions
 * cannot hold one, so this worker keeps the Gateway connection on an always-on
 * host and forwards admitted mentions to the agent's mention ingress route
 * (`POST /eve/v1/discord-mentions`).
 *
 * The bridge is transport only. It prefilters with the same admission policy
 * the agent re-checks, forwards the raw Discord message so the agent decides
 * from the original payload, and never posts to Discord for anything a session
 * owns. Replies and approval controls come from the agent's mention channel.
 *
 * Requirements: Node 22 or newer (global WebSocket), the bot token, the shared
 * bridge secret, and the same internal allowlists the deployment configures.
 * The application must have the privileged Message Content intent enabled in
 * the Discord developer portal, and its Interactions Endpoint URL must stay
 * unset so component interactions arrive here.
 *
 * Required environment:
 *   DISCORD_BOT_TOKEN          Bot token used for the Gateway connection.
 *   DISCORD_BRIDGE_SECRET      Shared secret that signs forwarded events.
 *   COMPUTER_BASE_URL          Deployment origin, e.g. https://wazoocomputer.vercel.app
 *
 * Optional environment:
 *   DISCORD_INTERNAL_GUILD_IDS, DISCORD_INTERNAL_CHANNEL_IDS,
 *   DISCORD_INTERNAL_USER_IDS, DISCORD_INTERNAL_ROLE_IDS   Admission allowlists.
 *   DISCORD_BRIDGE_RATE_LIMIT, DISCORD_BRIDGE_RATE_WINDOW_MS   Per-user replies per window
 *                                                             (defaults 6 per 60s).
 *   DISCORD_BRIDGE_MAX_IN_FLIGHT                               Concurrent forwarded events
 *                                                             (default 4).
 *   DISCORD_BRIDGE_QUEUE_LIMIT                                 Queued forwards before dropping.
 */

import {
  DISCORD_BRIDGE_MAX_BODY_LENGTH,
  DISCORD_BRIDGE_MAX_IN_FLIGHT,
  DISCORD_BRIDGE_SIGNATURE_HEADER,
  DISCORD_BRIDGE_TIMESTAMP_HEADER,
  DISCORD_BRIDGE_USER_LIMIT,
  DISCORD_BRIDGE_USER_WINDOW_MS,
  DISCORD_GATEWAY_FATAL_CLOSE_CODES,
  DISCORD_GATEWAY_INTENTS,
  createDedupeCache,
  createDiscordBridgeRequest,
  createRateLimiter,
  nextReconnectDelayMs,
} from "../../lib/discord-bridge.ts";
import { discordPolicyConfigFromEnv } from "../../lib/discord-policy.ts";
import { readDiscordMentionEvent, resolveDiscordMentionAdmission } from "../../lib/discord-mention-policy.ts";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const GATEWAY_INTENTS = DISCORD_GATEWAY_INTENTS;
const MENTION_ROUTE = "/eve/v1/discord-mentions";

/** Why a fatal close code can never be retried, for the operator log. */
const FATAL_CLOSE_REASONS = new Map<number, string>([
  [4004, "authentication failed; check DISCORD_BOT_TOKEN"],
  [4010, "invalid shard"],
  [4011, "sharding required"],
  [4012, "invalid API version"],
  [4013, "invalid gateway intents"],
  [4014, "disallowed gateway intents; enable Message Content for this application"],
]);

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required for the Discord Gateway bridge.`);
  }
  return value;
}

const botToken = requiredEnv("DISCORD_BOT_TOKEN");
const bridgeSecret = requiredEnv("DISCORD_BRIDGE_SECRET");
const computerBaseUrl = requiredEnv("COMPUTER_BASE_URL").replace(/\/+$/, "");
const policyConfig = discordPolicyConfigFromEnv();
const rateLimit = readPositiveInt(process.env.DISCORD_BRIDGE_RATE_LIMIT, DISCORD_BRIDGE_USER_LIMIT);
const rateWindowMs = readPositiveInt(process.env.DISCORD_BRIDGE_RATE_WINDOW_MS, DISCORD_BRIDGE_USER_WINDOW_MS);
const maxInFlight = readPositiveInt(process.env.DISCORD_BRIDGE_MAX_IN_FLIGHT, DISCORD_BRIDGE_MAX_IN_FLIGHT);
const queueLimit = readPositiveInt(process.env.DISCORD_BRIDGE_QUEUE_LIMIT, 25);

if (policyConfig.internalGuildIds.length === 0 || policyConfig.internalChannelIds.length === 0) {
  console.warn("bridge: no internal guild/channel allowlist configured; every mention will be denied");
}
if (policyConfig.internalUserIds.length === 0 && policyConfig.internalRoleIds.length === 0) {
  console.warn("bridge: no internal user/role allowlist configured; every mention will be denied");
}

const bot = { id: "" };
const seenMessages = createDedupeCache({ limit: 1024, ttlMs: 15 * 60 * 1000 });
const limiter = createRateLimiter({ limit: rateLimit, windowMs: rateWindowMs });

function log(level: "error" | "info" | "warn", event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ at: new Date().toISOString(), event, level, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

async function discordRequest(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${DISCORD_API_BASE}${path}`, {
    ...init,
    headers: { authorization: `Bot ${botToken}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

/** Forwards one event to the agent. Returns the response, or null on failure. */
async function forward(payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const body = JSON.stringify(payload);
  if (body.length > DISCORD_BRIDGE_MAX_BODY_LENGTH) {
    log("warn", "forwarded payload too large", { length: body.length });
    return null;
  }
  const request = createDiscordBridgeRequest({ body, nowMs: Date.now(), secret: bridgeSecret });
  try {
    const response = await fetch(`${computerBaseUrl}${MENTION_ROUTE}`, {
      body: request.body,
      headers: {
        "content-type": "application/json",
        [DISCORD_BRIDGE_SIGNATURE_HEADER]: request.signature,
        [DISCORD_BRIDGE_TIMESTAMP_HEADER]: request.timestamp,
      },
      method: "POST",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      log("error", "forward failed", { body: payload.kind, status: response.status });
      return null;
    }
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    log("error", "forward error", { body: payload.kind, error: String(error) });
    return null;
  }
}

/** Acknowledges one interaction so Discord does not show a failed interaction. */
async function acknowledgeInteraction(interaction: Record<string, unknown>, callback: Record<string, unknown>): Promise<void> {
  const id = interaction.id;
  const token = interaction.token;
  if (typeof id !== "string" || typeof token !== "string") return;
  try {
    await fetch(`${DISCORD_API_BASE}/interactions/${encodeURIComponent(id)}/${encodeURIComponent(token)}/callback`, {
      body: JSON.stringify(callback),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    log("warn", "interaction callback failed", { error: String(error) });
  }
}

function defaultAck(type: unknown): Record<string, unknown> {
  if (type === 3) return { type: 6 };
  if (type === 5) return { data: { content: "Answer received.", flags: 64 }, type: 4 };
  if (type === 1) return { type: 1 };
  return { data: { content: "Slash commands are retired. Mention Computer in the channel instead.", flags: 64 }, type: 4 };
}

async function handleInteraction(interaction: unknown): Promise<void> {
  if (typeof interaction !== "object" || interaction === null) return;
  const record = interaction as Record<string, unknown>;
  const result = await forward({ interaction, kind: "interaction" });
  const callback = result !== null && typeof result.callback === "object" && result.callback !== null
    ? (result.callback as Record<string, unknown>)
    : defaultAck(record.type);
  await acknowledgeInteraction(record, callback);
}

const queue: Array<{ event: unknown; messageId: string }> = [];
let inFlight = 0;

function drainQueue(): void {
  while (inFlight < maxInFlight && queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) return;
    inFlight += 1;
    void forward({ botUserId: bot.id, event: next.event, kind: "message" }).finally(() => {
      inFlight -= 1;
      drainQueue();
    });
  }
}

function handleMessage(raw: unknown): void {
  const event = readDiscordMentionEvent(raw);
  if (event === null) return;

  const now = Date.now();
  if (!seenMessages.firstSighting(event.messageId, now)) return;

  const admission = resolveDiscordMentionAdmission(event, policyConfig, { botUserId: bot.id });
  if (admission === null) return;

  if (!limiter.take(event.author.id, now)) {
    log("warn", "mention rate limited", { channelId: event.channelId, userId: event.author.id });
    return;
  }

  if (queue.length >= queueLimit) {
    log("warn", "mention queue full; dropped", { channelId: event.channelId });
    return;
  }
  queue.push({ event: raw, messageId: event.messageId });
  drainQueue();
}

interface GatewayState {
  sequence: number | null;
  sessionId: string | null;
  resumeUrl: string | null;
}

let socket: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatAcknowledged = true;
let reconnectAttempt = 0;
let stopped = false;
const state: GatewayState = { resumeUrl: null, sequence: null, sessionId: null };

async function resolveGatewayUrl(): Promise<string> {
  const response = await discordRequest("/gateway/bot");
  if (!response.ok) throw new Error(`gateway lookup failed with HTTP ${response.status}`);
  const body = (await response.json()) as { url?: unknown };
  if (typeof body.url !== "string" || body.url.length === 0) throw new Error("gateway lookup returned no url");
  return `${body.url}/?v=10&encoding=json`;
}

function send(payload: Record<string, unknown>): void {
  if (socket === null || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function stopHeartbeat(): void {
  if (heartbeatTimer !== null) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function scheduleReconnect(reason: string): void {
  if (stopped) return;
  stopHeartbeat();
  if (socket !== null) {
    socket.close();
    socket = null;
  }
  const delay = nextReconnectDelayMs(reconnectAttempt);
  reconnectAttempt += 1;
  log("warn", "reconnecting", { attempt: reconnectAttempt, delay, reason });
  setTimeout(() => void connect(), delay);
}

/**
 * Runs Discord's heartbeat contract: one beat per interval, and a reconnect
 * when a beat goes unacknowledged. The first beat is jittered, as Discord asks.
 */
function startHeartbeat(intervalMs: number): void {
  stopHeartbeat();
  heartbeatAcknowledged = true;

  const beat = (): void => {
    if (socket === null || socket.readyState !== WebSocket.OPEN) return;
    if (!heartbeatAcknowledged) {
      scheduleReconnect("heartbeat not acknowledged");
      return;
    }
    heartbeatAcknowledged = false;
    send({ d: state.sequence, op: 1 });
    heartbeatTimer = setTimeout(beat, intervalMs);
  };

  heartbeatTimer = setTimeout(beat, Math.floor(Math.random() * intervalMs));
}

function handleDispatch(type: string, data: unknown): void {
  if (type === "READY") {
    const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
    if (typeof record.session_id === "string") state.sessionId = record.session_id;
    if (typeof record.resume_gateway_url === "string") state.resumeUrl = record.resume_gateway_url;
    if (typeof record.user === "object" && record.user !== null) {
      const user = record.user as Record<string, unknown>;
      if (typeof user.id === "string") bot.id = user.id;
    }
    reconnectAttempt = 0;
    log("info", "gateway ready", { botId: bot.id, sessionId: state.sessionId });
    return;
  }
  if (type === "RESUMED") {
    reconnectAttempt = 0;
    log("info", "gateway resumed");
    return;
  }
  if (type === "MESSAGE_CREATE") {
    handleMessage(data);
    return;
  }
  if (type === "INTERACTION_CREATE") {
    void handleInteraction(data);
  }
}

async function connect(): Promise<void> {
  if (stopped) return;
  try {
    const url = state.sessionId !== null && state.resumeUrl !== null ? `${state.resumeUrl}/?v=10&encoding=json` : await resolveGatewayUrl();
    socket = new WebSocket(url);
  } catch (error) {
    log("error", "gateway connection failed", { error: String(error) });
    scheduleReconnect("connection failed");
    return;
  }

  socket.addEventListener("message", (message: MessageEvent) => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(String(message.data)) as Record<string, unknown>;
    } catch {
      return;
    }
    const op = payload.op;

    if (op === 0) {
      if (typeof payload.s === "number") state.sequence = payload.s;
      if (typeof payload.t === "string") handleDispatch(payload.t, payload.d);
      return;
    }
    if (op === 1) {
      send({ d: state.sequence, op: 1 });
      return;
    }
    if (op === 7) {
      scheduleReconnect("gateway requested reconnect");
      return;
    }
    if (op === 9) {
      const resumable = payload.d === true;
      if (!resumable) {
        state.sessionId = null;
        state.sequence = null;
      }
      scheduleReconnect("invalid session");
      return;
    }
    if (op === 10) {
      const record = typeof payload.d === "object" && payload.d !== null ? (payload.d as Record<string, unknown>) : {};
      const intervalMs = typeof record.heartbeat_interval === "number" ? record.heartbeat_interval : 45_000;
      startHeartbeat(intervalMs);
      if (state.sessionId !== null && state.sequence !== null) {
        send({ d: { seq: state.sequence, session_id: state.sessionId, token: botToken }, op: 6 });
      } else {
        send({
          d: {
            intents: GATEWAY_INTENTS,
            properties: { browser: "computer-discord-bridge", device: "computer-discord-bridge", os: process.platform },
            token: botToken,
          },
          op: 2,
        });
      }
      return;
    }
    if (op === 11) {
      heartbeatAcknowledged = true;
    }
  });

  socket.addEventListener("close", (event: CloseEvent) => {
    const fatal = DISCORD_GATEWAY_FATAL_CLOSE_CODES.includes(event.code);
    if (fatal) {
      log("error", "fatal gateway close", {
        code: event.code,
        reason: FATAL_CLOSE_REASONS.get(event.code) ?? "unrecoverable close code",
      });
      stopped = true;
      process.exitCode = 1;
      stopHeartbeat();
      return;
    }
    scheduleReconnect(`close ${event.code}`);
  });

  socket.addEventListener("error", () => {
    log("warn", "gateway socket error");
  });
}

async function main(): Promise<void> {
  const me = await discordRequest("/users/@me");
  if (!me.ok) throw new Error(`bot identity check failed with HTTP ${me.status}`);
  const identity = (await me.json()) as { id?: unknown; username?: unknown };
  if (typeof identity.id !== "string") throw new Error("bot identity check returned no id");
  bot.id = identity.id;
  log("info", "bridge starting", {
    botId: bot.id,
    intents: GATEWAY_INTENTS,
    route: `${computerBaseUrl}${MENTION_ROUTE}`,
    username: identity.username,
  });
  await connect();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopped = true;
    stopHeartbeat();
    socket?.close();
    log("info", "bridge stopping", { signal });
    process.exit(0);
  });
}

main().catch((error: unknown) => {
  log("error", "bridge failed to start", { error: String(error) });
  process.exitCode = 1;
});
