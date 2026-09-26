import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DISCORD_GATEWAY_FATAL_CLOSE_CODES,
  DISCORD_GATEWAY_INTENTS,
  createDedupeCache,
  createRateLimiter,
  nextReconnectDelayMs,
} from "./discord-bridge.ts";

const NOW = 1_776_000_000_000;

describe("gateway intents", () => {
  it("requests guilds, guild messages, and the privileged message content intent", () => {
    assert.equal(DISCORD_GATEWAY_INTENTS, (1 << 0) | (1 << 9) | (1 << 15));
  });

  it("treats the close codes Discord never lets a client retry as fatal", () => {
    for (const code of [4004, 4010, 4011, 4012, 4013, 4014]) {
      assert.equal(DISCORD_GATEWAY_FATAL_CLOSE_CODES.includes(code), true);
    }
    assert.equal(DISCORD_GATEWAY_FATAL_CLOSE_CODES.includes(4000), false);
    assert.equal(DISCORD_GATEWAY_FATAL_CLOSE_CODES.includes(1006), false);
  });
});

describe("nextReconnectDelayMs", () => {
  it("grows exponentially and stops at the ceiling", () => {
    assert.equal(nextReconnectDelayMs(0, () => 0.5), 1_000);
    assert.equal(nextReconnectDelayMs(1, () => 0.5), 2_000);
    assert.equal(nextReconnectDelayMs(3, () => 0.5), 8_000);
    assert.equal(nextReconnectDelayMs(20, () => 0.5), 60_000);
  });

  it("jitters within ten percent and never returns a negative delay", () => {
    const low = nextReconnectDelayMs(2, () => 0);
    const high = nextReconnectDelayMs(2, () => 1);
    assert.equal(low, 3_600);
    assert.equal(high, 4_400);
    assert.equal(nextReconnectDelayMs(-5, () => 0), 900);
  });
});

describe("createDedupeCache", () => {
  it("reports only the first sighting inside the window", () => {
    const cache = createDedupeCache({ limit: 10, ttlMs: 1_000 });
    assert.equal(cache.firstSighting("m1", NOW), true);
    assert.equal(cache.firstSighting("m1", NOW + 500), false);
  });

  it("forgets an id once the TTL has passed", () => {
    const cache = createDedupeCache({ limit: 10, ttlMs: 1_000 });
    cache.firstSighting("m1", NOW);
    assert.equal(cache.firstSighting("m1", NOW + 1_001), true);
  });

  it("evicts the oldest ids above the limit", () => {
    const cache = createDedupeCache({ limit: 2, ttlMs: 60_000 });
    cache.firstSighting("m1", NOW);
    cache.firstSighting("m2", NOW + 1);
    cache.firstSighting("m3", NOW + 2);
    assert.equal(cache.size() <= 2, true);
    assert.equal(cache.firstSighting("m3", NOW + 3), false);
  });
});

describe("createRateLimiter", () => {
  it("counts a window per key", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1_000 });
    assert.equal(limiter.take("alice", NOW), true);
    assert.equal(limiter.take("alice", NOW + 1), true);
    assert.equal(limiter.take("alice", NOW + 2), false);
    assert.equal(limiter.take("bob", NOW + 2), true);
  });

  it("opens a fresh window once it expires", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000 });
    assert.equal(limiter.take("alice", NOW), true);
    assert.equal(limiter.take("alice", NOW + 999), false);
    assert.equal(limiter.take("alice", NOW + 1_000), true);
  });
});
