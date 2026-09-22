import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DISCORD_BRIDGE_MAX_BODY_LENGTH,
  DISCORD_BRIDGE_MAX_SIGNATURE_AGE_MS,
  DISCORD_GATEWAY_FATAL_CLOSE_CODES,
  DISCORD_GATEWAY_INTENTS,
  createDedupeCache,
  createDiscordBridgeRequest,
  createRateLimiter,
  nextReconnectDelayMs,
  signDiscordBridgeBody,
  verifyDiscordBridgeRequest,
} from "./discord-bridge.ts";

const SECRET = "bridge-secret";
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

describe("createDiscordBridgeRequest", () => {
  it("signs the timestamp and body together", () => {
    const request = createDiscordBridgeRequest({ body: '{"kind":"message"}', nowMs: NOW, secret: SECRET });
    assert.equal(request.timestamp, String(NOW));
    assert.equal(
      request.signature,
      signDiscordBridgeBody({ body: request.body, secret: SECRET, timestamp: request.timestamp }),
    );
  });
});

describe("verifyDiscordBridgeRequest", () => {
  const request = createDiscordBridgeRequest({ body: '{"kind":"message"}', nowMs: NOW, secret: SECRET });

  it("accepts a fresh request signed with the shared secret", () => {
    assert.equal(
      verifyDiscordBridgeRequest({ ...request, nowMs: NOW + 1_000, secret: SECRET }),
      true,
    );
  });

  it("rejects a request signed with a different secret", () => {
    assert.equal(
      verifyDiscordBridgeRequest({ ...request, nowMs: NOW, secret: "other-secret" }),
      false,
    );
  });

  it("rejects a tampered body", () => {
    assert.equal(
      verifyDiscordBridgeRequest({ ...request, body: '{"kind":"interaction"}', nowMs: NOW, secret: SECRET }),
      false,
    );
  });

  it("rejects a missing secret, signature, or timestamp", () => {
    assert.equal(verifyDiscordBridgeRequest({ ...request, nowMs: NOW, secret: "" }), false);
    assert.equal(verifyDiscordBridgeRequest({ ...request, nowMs: NOW, secret: SECRET, signature: null }), false);
    assert.equal(verifyDiscordBridgeRequest({ ...request, nowMs: NOW, secret: SECRET, timestamp: undefined }), false);
  });

  it("rejects a signature that is not hex, without throwing", () => {
    assert.equal(
      verifyDiscordBridgeRequest({ ...request, nowMs: NOW, secret: SECRET, signature: "not-a-signature" }),
      false,
    );
  });

  it("rejects a replayed request once the timestamp falls outside the window", () => {
    const age = DISCORD_BRIDGE_MAX_SIGNATURE_AGE_MS;
    assert.equal(verifyDiscordBridgeRequest({ ...request, nowMs: NOW + age, secret: SECRET }), true);
    assert.equal(verifyDiscordBridgeRequest({ ...request, nowMs: NOW + age + 1, secret: SECRET }), false);
  });

  it("rejects a future-dated request", () => {
    const future = createDiscordBridgeRequest({
      body: request.body,
      nowMs: NOW + DISCORD_BRIDGE_MAX_SIGNATURE_AGE_MS + 1,
      secret: SECRET,
    });
    assert.equal(verifyDiscordBridgeRequest({ ...future, nowMs: NOW, secret: SECRET }), false);
  });

  it("rejects a body above the accepted length", () => {
    const body = `{"content":"${"x".repeat(DISCORD_BRIDGE_MAX_BODY_LENGTH)}"}`;
    const oversized = createDiscordBridgeRequest({ body, nowMs: NOW, secret: SECRET });
    assert.equal(verifyDiscordBridgeRequest({ ...oversized, nowMs: NOW, secret: SECRET }), false);
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
