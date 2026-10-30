import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signComputerChatSession, verifyComputerChatSession } from "./computer-chat-session.ts";

const secret = "a".repeat(64);
const session = {
  userId: "user-123",
  sessionId: "session-123",
  conversationId: "conv_abc123",
};

describe("Computer chat session tickets", () => {
  it("signs and verifies a ticket bound to one user and web session", () => {
    const token = signComputerChatSession(session, secret);
    assert.deepEqual(verifyComputerChatSession(token, secret, session), { ...session, version: 1 });
  });

  it("rejects a ticket for a different user or session", () => {
    const token = signComputerChatSession(session, secret);
    assert.equal(
      verifyComputerChatSession(token, secret, { ...session, userId: "other-user" }),
      null,
    );
    assert.equal(
      verifyComputerChatSession(token, secret, { ...session, sessionId: "other-session" }),
      null,
    );
  });

  it("rejects tampering, noncanonical base64url, and signatures with the wrong byte length", () => {
    const token = signComputerChatSession(session, secret);
    const [payload, signature] = token.split(".");
    assert.equal(verifyComputerChatSession(`${payload}x.${signature}`, secret, session), null);
    assert.equal(verifyComputerChatSession(`${payload}.${signature.slice(1)}`, secret, session), null);
    assert.equal(verifyComputerChatSession(`${payload}!.${signature}`, secret, session), null);
  });

  it("rejects keys shorter than 32 bytes", () => {
    assert.throws(() => signComputerChatSession(session, "short"), /at least 32 bytes/);
    const token = signComputerChatSession(session, secret);
    assert.equal(verifyComputerChatSession(token, "short", session), null);
  });

  it("uses UTF-8 byte lengths and canonical base64url for signed data", () => {
    const multibyteSecret = "é".repeat(16);
    const unicodeSession = { ...session, conversationId: "conv_é" };
    const token = signComputerChatSession(unicodeSession, multibyteSecret);
    assert.deepEqual(
      verifyComputerChatSession(token, multibyteSecret, unicodeSession),
      { ...unicodeSession, version: 1 },
    );
    assert.throws(
      () => signComputerChatSession(session, "é".repeat(15)),
      /at least 32 bytes/,
    );
  });

  it("rejects oversized ticket input before decoding it", () => {
    const token = signComputerChatSession(session, secret);
    assert.equal(verifyComputerChatSession(`${token}${"a".repeat(8_192)}`, secret, session), null);
  });
});
