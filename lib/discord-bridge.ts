/**
 * Transport primitives for Computer's Discord channel.
 *
 * The channel is a small always-on worker that holds one Gateway connection and
 * turns an admitted `MESSAGE_CREATE` event into one Computer turn. Everything in
 * this module is pure and deterministic so the transport can be tested without a
 * live Discord connection: intents, reconnect backoff, de-duplication, and
 * per-principal rate limiting.
 */

/** Gateway close codes Discord never lets a client recover from silently. */
export const DISCORD_GATEWAY_FATAL_CLOSE_CODES: readonly number[] = [4004, 4010, 4011, 4012, 4013, 4014];

/** Gateway intents the channel requests, as a bitfield. */
export const DISCORD_GATEWAY_INTENTS =
  // GUILDS: channel and thread metadata.
  (1 << 0) |
  // GUILD_MESSAGES: ordinary messages in guild text channels and threads.
  (1 << 9) |
  // MESSAGE_CONTENT (privileged): the message text, mentions, and attachments.
  (1 << 15);

/** Per-user turn budget inside one rate-limit window. */
export const DISCORD_BRIDGE_USER_LIMIT = 6;
/** Rate-limit window length, in milliseconds. */
export const DISCORD_BRIDGE_USER_WINDOW_MS = 60 * 1000;

/** Base reconnect delay, in milliseconds. */
const RECONNECT_BASE_MS = 1_000;
/** Ceiling for the reconnect delay, in milliseconds. */
const RECONNECT_MAX_MS = 60_000;
/** Number of doublings before the delay stops growing. */
const RECONNECT_MAX_DOUBLINGS = 6;

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
 * Best-effort de-duplication by id with a time-to-live.
 *
 * One Discord message can reach the channel twice: a Gateway resume replays
 * events the client may already have handled, and a turn runs while the next
 * event is read off the socket. A duplicate that slips past Discord's own
 * replay window is dropped here.
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
 * member's budget. Entries are evicted as they expire, so a long-lived channel
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
