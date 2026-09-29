"use client";

import { useState } from "react";
import { consumeZoSse } from "@/lib/zo-sse";

export default function PreviewHealthCheck() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState("");
  const [gateRunning, setGateRunning] = useState(false);
  const [gateResult, setGateResult] = useState("");

  async function runChatGateProbe() {
    if (gateRunning || gateResult) return;
    setGateRunning(true);
    const startedAt = Date.now();
    try {
      const response = await fetch(`/api/chat/${encodeURIComponent(crypto.randomUUID())}`, {
        method: "POST",
        headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
        body: "{}",
      });
      setGateResult(JSON.stringify({
        status: response.status,
        expectedStatus: 400,
        passed: response.status === 400,
        elapsedMs: Date.now() - startedAt,
      }, null, 2));
    } catch {
      setGateResult(JSON.stringify({
        passed: false,
        error: "The chat gate request failed before a response.",
        elapsedMs: Date.now() - startedAt,
      }, null, 2));
    } finally {
      setGateRunning(false);
    }
  }

  async function runCheck() {
    if (running || result) return;
    setRunning(true);
    const startedAt = Date.now();
    const output: string[] = [];

    try {
      const response = await fetch("/api/preview-chat-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => ({}));
        setResult(JSON.stringify({ status: response.status, ...detail }, null, 2));
        return;
      }

      await consumeZoSse(response.body, (text) => output.push(text));
      const reply = output.join("").trim();
      setResult(JSON.stringify({
        status: response.status,
        completed: true,
        replyWasExpected: /^ok[.!]?$/iu.test(reply),
        outputCharacters: reply.length,
        elapsedMs: Date.now() - startedAt,
      }, null, 2));
    } catch (error) {
      setResult(JSON.stringify({
        completed: false,
        error: error instanceof Error ? error.message : "Stream failed.",
        outputCharacters: output.join("").length,
        elapsedMs: Date.now() - startedAt,
      }, null, 2));
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-6 text-foreground">
      <h1 className="text-2xl font-semibold">Preview chat health check</h1>
      <p className="text-muted-foreground">Runs one protected-preview Zo stream through the browser parser and reports metadata only.</p>
      <button
        type="button"
        onClick={runChatGateProbe}
        disabled={gateRunning || Boolean(gateResult)}
        className="w-fit rounded-md bg-secondary px-4 py-2 text-secondary-foreground disabled:opacity-50"
      >
        {gateRunning ? "Checking chat gate…" : gateResult ? "Gate probe used" : "Check chat gate (no Zo call)"}
      </button>
      <pre aria-live="polite" className="whitespace-pre-wrap rounded-md border bg-card p-4 text-sm">
        {gateResult}
      </pre>
      <button
        type="button"
        onClick={runCheck}
        disabled={running || Boolean(result)}
        className="w-fit rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
      >
        {running ? "Checking…" : result ? "Check used" : "Run one health check"}
      </button>
      <pre aria-live="polite" className="whitespace-pre-wrap rounded-md border bg-card p-4 text-sm">
        {result}
      </pre>
    </main>
  );
}
