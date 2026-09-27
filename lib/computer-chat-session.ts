import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_BYTES = 32;
const MIN_SECRET_BYTES = 32;
const MAX_TOKEN_BYTES = 8_192;

export type ComputerChatSession = {
  readonly version: 1;
  readonly userId: string;
  readonly sessionId: string;
  readonly conversationId: string;
};

export function signComputerChatSession(
  session: Omit<ComputerChatSession, "version">,
  secret: string,
): string {
  requireSecret(secret);
  const payload: ComputerChatSession = { ...session, version: 1 };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload, "utf8").digest("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifyComputerChatSession(
  token: string,
  secret: string,
  expected: { readonly userId: string; readonly sessionId: string },
): ComputerChatSession | null {
  if (Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES) return null;
  if (Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, encodedSignature] = parts;
  if (!isBase64Url(encodedPayload) || !isBase64Url(encodedSignature)) return null;

  const payloadBytes = Buffer.from(encodedPayload, "base64url");
  if (payloadBytes.toString("base64url") !== encodedPayload) return null;

  const signature = Buffer.from(encodedSignature, "base64url");
  if (signature.length !== SIGNATURE_BYTES || signature.toString("base64url") !== encodedSignature) {
    return null;
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(encodedPayload, "utf8")
    .digest();
  if (expectedSignature.length !== signature.length || !timingSafeEqual(expectedSignature, signature)) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    return null;
  }
  if (!isComputerChatSession(value)) return null;
  if (value.userId !== expected.userId || value.sessionId !== expected.sessionId) return null;
  return value;
}

function isComputerChatSession(value: unknown): value is ComputerChatSession {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    typeof candidate.userId === "string" &&
    candidate.userId.length > 0 &&
    typeof candidate.sessionId === "string" &&
    candidate.sessionId.length > 0 &&
    typeof candidate.conversationId === "string" &&
    candidate.conversationId.length > 0 &&
    candidate.conversationId.length <= 512
  );
}

function isBase64Url(value: string): boolean {
  return value.length > 0 && /^[A-Za-z0-9_-]+$/.test(value);
}

function requireSecret(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES) {
    throw new Error("COMPUTER_CHAT_SESSION_SECRET must be at least 32 bytes.");
  }
}
