"use client";

import { useState } from "react";

export default function PreviewHealthCheck() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState("");

  async function runCheck() {
    if (running || result) return;
    setRunning(true);
    try {
      const response = await fetch("/api/preview-chat-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      setResult(`${response.status} ${await response.text()}`);
    } catch {
      setResult("Health check request failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-6 text-foreground">
      <h1 className="text-2xl font-semibold">Preview chat health check</h1>
      <p className="text-muted-foreground">Runs one Zo-backed stream check and displays only non-sensitive completion metadata.</p>
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
