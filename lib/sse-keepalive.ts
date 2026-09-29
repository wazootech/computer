const encoder = new TextEncoder();

export function withSseKeepalive(
  source: ReadableStream<Uint8Array>,
  intervalMs = 15_000,
): ReadableStream<Uint8Array> {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new RangeError("The SSE keepalive interval must be a positive safe integer.");
  }

  const reader = source.getReader();
  let pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
  let stopped = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (stopped) return;
      pendingRead ??= reader.read();

      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const next = await Promise.race([
          pendingRead.then((result) => ({ kind: "read" as const, result })),
          new Promise<{ kind: "heartbeat" }>((resolve) => {
            timer = setTimeout(() => resolve({ kind: "heartbeat" }), intervalMs);
          }),
        ]);

        if (stopped) return;
        if (next.kind === "heartbeat") {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
          return;
        }

        pendingRead = undefined;
        if (next.result.done) {
          stopped = true;
          reader.releaseLock();
          controller.close();
          return;
        }
        if (next.result.value) controller.enqueue(next.result.value);
      } catch (error) {
        if (!stopped) {
          stopped = true;
          controller.error(error);
        }
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
    async cancel(reason) {
      stopped = true;
      await reader.cancel(reason);
    },
  });
}
