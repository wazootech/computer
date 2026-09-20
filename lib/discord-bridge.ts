import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Transport primitives for the Discord Gateway mention bridge.
 *
 * The bridge is a small always-on worker that holds one Gateway connection and
 * forwards admitted `MESSAGE_CREATE` events to the eve app over HTTP. Everything
 * in this module is pure and deterministic so the transport can be tested
 * without a live Discord connection: intents, reconnect backoff, de-duplication,
 * per-principal rate limiting, and the bridge signature that authenticates the
 * forwarded request.
 */

/** Gateway close code for an unauthenticated connection: the bot token is wrong. */
export const DISCORD_GATEWAY_FATAL_CLOSE_CODES: readonly number[] = [4004, 4010, 4011, 4012, 4013, 4014];

/** Gateway intents the bridge requests, as a bitfield. */
export const DISCORD_GATEWAY_INTENTS =
  // GUILDS: channel and thread metadata.
  (1 << 0) |
  // GUILD_MESSAGES: ordinary messages in guild text channels and threads.
  (1 << 9) |
  // MESSAGE_CONTENT (privileged): the message text, mentions, and attachments.
  (1 << 15);

/** Header carrying the bridge signature. */
export const DISCORD_BRIDGE_SIGNATURE_HEADER = "x-computer-bridge-signature";
/** Header carrying the signature timestamp, in epoch milliseconds. */
export const DISCORD_BRIDGE_TIMESTAMP_HEADER = "x-computer-bridge-timestamp";
/** Maximum accepted signature age, in milliseconds. */
export const DISCORD_BRIDGE_MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;
/** Maximum accepted forwarded request body length, in characters. */
export const DISCORD_BRIDGE_MAX_BODY_LENGTH = 32 * 1024;
/** Maximum forwarded events in flight at once. */
export const DISCORD_BRIDGE_MAX_IN_FLIGHT = 4;
/** Per-user event budget inside one rate-limit window. */
export const DISCORD_BRIDGE_USER_LIMIT = 6;
/** Rate-limit window length, in milliseconds. */
export const DISCORD_BRIDGE_USER_WINDOW_MS = 60 * 1000;

/** Base reconnect delay, in milliseconds. */
const RECONNECT_BASE_MS = 1_000;
/** Ceiling for the reconnect delay, in milliseconds. */
const RECONNECT_MAX_MS = 60_000;
/** Number of doublings before the delay stops growing. */
const RECONNECT_MAX_DOUBLINGS = 6;

/** One forwarded bridge request, exactly as it goes over the wire. */
export interface DiscordBridgeRequest {
  readonly body: string;
  readonly signature: string;
  readonly timestamp: string;
}

/**
 * Exponential reconnect backoff with symmetric jitter.
 *
 * `attempt` is the number of consecutive failures so far. The random source is
 * injected so reconnect timing is deterministic in tests.
 */
export function nextReconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const steps = Math.max(0, Math.floor(attempt));
  const growth = 2 ** Math.min(steps, RECONNECT_MAX_DOUBLINGS);
  const base = Math.min(RECONNECT_BASE_MS * growth, RECONNECT_MAX_MS);
  const jitter = (random() * 2 - 1) * 0.1 * base;
  return Math.max(0, Math.round(base + jitter));
}

/**
 * Computes the bridge signature for one body: HMAC-SHA256 over
 * `"<timestamp>.<body>"`, hex encoded.
 */
export function signDiscordBridgeBody(input: {
  readonly body: string;
  readonly secret: string;
  readonly timestamp: string;
}): string {
  return createHmac("sha256", input.secret).update(`${input.timestamp}.${input.body}`).digest("hex");
}

/** Builds the signed request the bridge sends to the eve app. */
export function createDiscordBridgeRequest(input: {
  readonly body: string;
  readonly nowMs: number;
  readonly secret: string;
}): DiscordBridgeRequest {
  const timestamp = String(Math.floor(input.nowMs));
  return {
    body: input.body,
    signature: signDiscordBridgeBody({ body: input.body, secret: input.secret, timestamp }),
    timestamp,
  };
}

/**
 * Verifies one forwarded request. Fails closed on a missing secret, a missing
 * or malformed header, a body outside the accepted window, a stale or
 * future-dated timestamp, and a signature mismatch. The comparison is
 * constant-time and length-checked before it runs.
 */
export function verifyDiscordBridgeRequest(input: {
  readonly body: string;
  readonly nowMs: number;
  readonly secret: string;
  readonly signature: string | null | undefined;
  readonly timestamp: string | null | undefined;
}): boolean {
  if (input.secret.length === 0) return false;
  if (input.signature === null || input.signature === undefined || input.signature.length === 0) return false;
  if (input.timestamp === null || input.timestamp === undefined || !/^\d{1,20}$/.test(input.timestamp)) return false;
  if (input.body.length > DISCORD_BRIDGE_MAX_BODY_LENGTH) return false;

  const issuedAt = Number(input.timestamp);
  if (!Number.isFinite(issuedAt)) return false;
  if (Math.abs(input.nowMs - issuedAt) > DISCORD_BRIDGE_MAX_SIGNATURE_AGE_MS) return false;

  const expected = signDiscordBridgeBody({ body: input.body, secret: input.secret, timestamp: input.timestamp });
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(input.signature, "utf8");
  if (expectedBytes.length !== actualBytes.length) return false;
  return timingSafeEqual(expectedBytes, actualBytes);
}

/**
 * Best-effort de-duplication by id with a time-to-live.
 *
 * One Discord message can reach the bridge twice: a Gateway resume replays
 * events the client may already have handled, and the bridge retries a forward
 * that failed after Discord accepted the event. Both callers and the eve app
 * keep their own cache, so a duplicate that slips past one boundary is dropped
 * at the next.
 */
export function createDedupeCache(input: { readonly limit: number; readonly ttlMs: number }) {
  const seen = new Map<string, number>();

  function prune(nowMs: number): void {
    for (const [id, at] of seen) {
      if (nowMs - at > input.ttlMs) seen.delete(id);
    }
    while (seen.size > input.limit) {
      const oldest = seen.keys().next();
      if (oldest.done === true) break;
      seen.delete(oldest.value);
    }
  }

  return {
    /** Records an id and reports whether it had not been seen inside the TTL. */
    firstSighting(id: string, nowMs: number): boolean {
      const previous = seen.get(id);
      if (previous !== undefined && nowMs - previous <= input.ttlMs) return false;
      seen.set(id, nowMs);
      prune(nowMs);
      return true;
    },
    size(): number {
      return seen.size;
    },
  };
}

/**
 * Fixed-window per-key rate limiter.
 *
 * Windows are stored per key so a burst from one member cannot consume another
 * member's budget. Entries are evicted as they expire, so a long-lived bridge
 * does not accumulate one map entry per Discord id it has ever seen.
 */
export function createRateLimiter(input: { readonly limit: number; readonly windowMs: number }) {
  const windows = new Map<string, { count: number; startedAt: number }>();

  function prune(nowMs: number): void {
    for (const [key, window] of windows) {
      if (nowMs - window.startedAt >= input.windowMs) windows.delete(key);
    }
  }

  return {
    /** Consumes one unit for a key and reports whether it stayed inside the window. */
    take(key: string, nowMs: number): boolean {
      const window = windows.get(key);
      if (window === undefined || nowMs - window.startedAt >= input.windowMs) {
        windows.set(key, { count: 1, startedAt: nowMs });
        prune(nowMs);
        return true;
      }
      if (window.count >= input.limit) return false;
      window.count += 1;
      return true;
    },
  };
}
