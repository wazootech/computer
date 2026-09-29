import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { consumeZoSse } from "./zo-sse.ts";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("Zo SSE parsing", () => {
  it("reassembles split chunks and emits FrontendModelResponse text", async () => {
    const output: string[] = [];
    await consumeZoSse(
      streamFromChunks([
        'event: FrontendModelResponse\ndata: {"content":"Hello "}\n\n',
        'event: FrontendModelResponse\ndata: {"content":"world"}\n\n',
        'event: End\ndata: {}\n\n',
      ]),
      (text) => output.push(text),
    );
    assert.deepEqual(output, ["Hello ", "world"]);
  });

  it("handles a frame split across transport chunks", async () => {
    const output: string[] = [];
    await consumeZoSse(
      streamFromChunks([
        'event: FrontendModelResponse\ndata: {"con',
        'tent":"ok"}\n\n',
        'event: End\ndata: {}\n\n',
      ]),
      (text) => output.push(text),
    );
    assert.deepEqual(output, ["ok"]);
  });

  it("handles split CRLF framing and uses End output when no text chunks were emitted", async () => {
    const output: string[] = [];
    await consumeZoSse(
      streamFromChunks(['event: End\r', '\ndata: {"output":"Done"}\r\n\r\n']),
      (text) => output.push(text),
    );
    assert.deepEqual(output, ["Done"]);
  });

  it("accepts an End event without a data payload", async () => {
    const output: string[] = [];
    await consumeZoSse(
      streamFromChunks([
        'event: FrontendModelResponse\ndata: {"content":"ok"}\n\n',
        "event: End\n\n",
      ]),
      (text) => output.push(text),
    );
    assert.deepEqual(output, ["ok"]);
  });

  it("does not duplicate text when End also carries output", async () => {
    const output: string[] = [];
    await consumeZoSse(
      streamFromChunks([
        'event: FrontendModelResponse\ndata: {"content":"chunk"}\n\n',
        'event: End\ndata: {"output":"chunk"}\n\n',
      ]),
      (text) => output.push(text),
    );
    assert.deepEqual(output, ["chunk"]);
  });

  it("fails closed on Zo Error events and incomplete streams", async () => {
    await assert.rejects(
      consumeZoSse(streamFromChunks(['event: Error\ndata: {"message":"secret detail"}\n\n']), () => {}),
      /could not complete/,
    );
    await assert.rejects(
      consumeZoSse(
        streamFromChunks(['event: FrontendModelResponse\ndata: {"content":"partial"}\n\n']),
        () => {},
      ),
      /incomplete streaming response/,
    );
  });
});
