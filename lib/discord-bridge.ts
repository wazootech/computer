/**
 * Bounded duplicate suppression and per-user rate limiting for Computer's
 * Discord channel. The Gateway lifecycle is managed by discord.js.
 */

/** Per-user turn budget inside one rate-limit window. */
export const DISCORD_BRIDGE_USER_LIMIT = 6;
/** Rate-limit window length, in milliseconds. */
export const DISCORD_BRIDGE_USER_WINDOW_MS = 60 * 1000;

/**
 * Best-effort de-duplication by id with a time-to-live.
 *
 * Discord may replay events after a Gateway resume. A duplicate that slips past
 * the library's replay handling is dropped here.
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
 * member's budget. Expired entries are evicted rather than accumulated.
 */
export function createRateLimiter(input: { readonly limit: number; readonly windowMs: number }) {
  const windows = new Map<string, { count: number; startedAt: number }>();

  function prune(nowMs: number): void {
    for (const [key, window] of windows) {
      if (nowMs - window.startedAt >= input.windowMs) windows.delete(key);
    }
  }

  return {
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
