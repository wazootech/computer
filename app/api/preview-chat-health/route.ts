import { consumeZoSse } from "@/lib/zo-sse";

export const runtime = "nodejs";
export const maxDuration = 300;

let healthCheckUsed = false;

export async function POST(): Promise<Response> {
  if (process.env.VERCEL_ENV !== "preview") return new Response(null, { status: 404 });
  if (healthCheckUsed) return Response.json({ error: "Health check already consumed." }, { status: 410 });
  healthCheckUsed = true;

  const proxySecret = process.env.COMPUTER_WEB_SECRET;
  if (!proxySecret || Buffer.byteLength(proxySecret, "utf8") < 32) {
    return Response.json({ error: "Preview chat proxy is not configured." }, { status: 503 });
  }

  const startedAt = Date.now();
  const output: string[] = [];
  let upstream: Response | undefined;

  try {
    upstream = await fetch("https://etok.zo.space/api/computer-chat", {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "X-Computer-Web-Secret": proxySecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: "Reply with exactly OK." }),
      signal: AbortSignal.timeout(300_000),
      cache: "no-store",
    });

    if (!upstream.ok) {
      await upstream.body?.cancel();
      return Response.json({ ok: false, stage: "upstream_status", status: upstream.status }, { status: 502 });
    }
    if (!upstream.body) {
      return Response.json({ ok: false, stage: "missing_stream" }, { status: 502 });
    }

    const conversationIdPresent = Boolean(upstream.headers.get("x-conversation-id"));
    if (!conversationIdPresent) {
      await upstream.body.cancel();
      return Response.json({ ok: false, stage: "missing_conversation_id" }, { status: 502 });
    }

    await consumeZoSse(upstream.body, (text) => output.push(text));
    const reply = output.join("").trim();
    return Response.json({
      ok: true,
      completed: true,
      replyWasExpected: /^ok[.!]?$/iu.test(reply),
      conversationIdPresent,
      outputCharacters: reply.length,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    await upstream?.body?.cancel().catch(() => {});
    return Response.json({
      ok: false,
      completed: false,
      stage: error instanceof Error && error.message.includes("incomplete streaming")
        ? "incomplete_stream"
        : "request_failed",
      outputCharacters: output.join("").length,
      elapsedMs: Date.now() - startedAt,
    }, { status: 502 });
  }
}
