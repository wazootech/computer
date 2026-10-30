import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSameOriginRequest } from "./computer-chat-origin.ts";

describe("same-origin chat requests", () => {
  it("accepts only the request URL's origin", () => {
    assert.equal(
      isSameOriginRequest(
        new Request("https://computer.example/api/chat/session-123", {
          headers: { origin: "https://computer.example" },
        }),
      ),
      true,
    );
    assert.equal(
      isSameOriginRequest(
        new Request("https://computer.example/api/chat/session-123", {
          headers: { origin: "https://attacker.example" },
        }),
      ),
      false,
    );
  });

  it("rejects missing or invalid origins and ignores forwarded-host headers", () => {
    assert.equal(isSameOriginRequest(new Request("https://computer.example/api/chat/session-123")), false);
    assert.equal(
      isSameOriginRequest(
        new Request("https://computer.example/api/chat/session-123", {
          headers: { origin: "https://computer.example", "x-forwarded-host": "attacker.example" },
        }),
      ),
      true,
    );
    assert.equal(
      isSameOriginRequest(
        new Request("https://computer.example/api/chat/session-123", {
          headers: { origin: "null" },
        }),
      ),
      false,
    );
  });
});
