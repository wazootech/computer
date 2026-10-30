import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDedupeCache, createRateLimiter } from "./discord-bridge.ts";

const NOW = 1_776_000_000_000;

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
