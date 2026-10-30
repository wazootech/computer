import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withSseKeepalive } from "./sse-keepalive.ts";
import { consumeZoSse } from "./zo-sse.ts";

const encoder = new TextEncoder();

function delayedZoResponse(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('event: FrontendModelResponse\ndata: {"content":"OK"}\n\n'));
      setTimeout(() => {
        controller.enqueue(encoder.encode("event: End\n\n"));
        controller.close();
      }, 35);
    },
  });
}

describe("SSE keepalive", () => {
  it("emits comment heartbeats during upstream silence and preserves completion", async () => {
    const reader = withSseKeepalive(delayedZoResponse(), 5).getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }

    const streamText = Buffer.concat(chunks).toString("utf8");
    assert.match(streamText, /: keepalive\n\n/u);
    assert.match(streamText, /event: End\n\n/u);

    const output: string[] = [];
    await consumeZoSse(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
      (text) => output.push(text),
    );
    assert.equal(output.join(""), "OK");
  });

  it("rejects an invalid heartbeat interval", () => {
    assert.throws(() => withSseKeepalive(new ReadableStream(), 0), /positive safe integer/u);
  });
});
