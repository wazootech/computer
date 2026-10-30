type ZoEventState = { completed: boolean; receivedText: boolean };

export async function consumeZoSse(
  body: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const state: ZoEventState = { completed: false, receivedText: false };
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (done) {
        buffer += decoder.decode();
        break;
      }

      const extracted = extractSseBlocks(buffer);
      buffer = extracted.remainder;
      for (const block of extracted.blocks) dispatchZoEvent(block, state, onText);
    }

    const finalBlock = buffer.trim();
    if (finalBlock.length > 0) dispatchZoEvent(finalBlock, state, onText);
    if (!state.completed) throw new Error("Computer received an incomplete streaming response.");
  } finally {
    reader.releaseLock();
  }
}

function extractSseBlocks(buffer: string): { blocks: string[]; remainder: string } {
  const blocks: string[] = [];
  const separator = /\r?\n\r?\n/g;
  let start = 0;
  let match = separator.exec(buffer);
  while (match !== null) {
    blocks.push(buffer.slice(start, match.index));
    start = match.index + match[0].length;
    match = separator.exec(buffer);
  }
  return { blocks, remainder: buffer.slice(start) };
}

function dispatchZoEvent(block: string, state: ZoEventState, onText: (text: string) => void): void {
  if (state.completed) return;
  let event = "message";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if ((event === "End" || event === "completed") && data.length === 0) {
    state.completed = true;
    return;
  }
  if (data.length === 0) return;

  let payload: unknown;
  try {
    payload = JSON.parse(data.join("\n"));
  } catch {
    throw new Error("Computer received an invalid streaming response.");
  }
  if (typeof payload !== "object" || payload === null) return;
  const value = payload as Record<string, unknown>;

  if (event === "FrontendModelResponse") {
    if (typeof value.content !== "string") {
      throw new Error("Computer received an invalid text chunk.");
    }
    emitText(value.content, state, onText);
    return;
  }
  if (event === "PartStartEvent") {
    const part = isRecord(value.part) ? value.part : undefined;
    if (part?.part_kind === "text" && typeof part.content === "string") {
      emitText(part.content, state, onText);
    }
    return;
  }
  if (event === "PartDeltaEvent") {
    const delta = isRecord(value.delta) ? value.delta : undefined;
    const text = typeof value.delta === "string"
      ? value.delta
      : typeof delta?.content_delta === "string"
        ? delta.content_delta
        : typeof delta?.content === "string"
          ? delta.content
          : undefined;
    if (text !== undefined) emitText(text, state, onText);
    return;
  }
  if (event === "Error" || event === "error") {
    throw new Error("Computer could not complete the response.");
  }
  if (event === "End") {
    if (!state.receivedText && typeof value.output === "string") {
      emitText(value.output, state, onText);
    }
    state.completed = true;
    return;
  }
  if (event === "completed") {
    if (value.status !== "succeeded") {
      throw new Error("Computer could not complete the response.");
    }
    if (!state.receivedText && typeof value.output === "string") {
      emitText(value.output, state, onText);
    }
    state.completed = true;
  }
}

function emitText(text: string, state: ZoEventState, onText: (text: string) => void): void {
  if (text.length === 0) return;
  state.receivedText = true;
  onText(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
