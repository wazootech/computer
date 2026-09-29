import { withSseKeepalive } from "@/lib/sse-keepalive";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

let healthCheckUsed = false;

export async function POST(): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  if (process.env.VERCEL_ENV !== "preview") return new Response(null, { status: 404, headers });
  if (healthCheckUsed) return Response.json({ error: "Health check already consumed." }, { status: 410, headers });
  healthCheckUsed = true;

  const proxySecret = process.env.COMPUTER_WEB_SECRET;
  if (!proxySecret || Buffer.byteLength(proxySecret, "utf8") < 32) {
    return Response.json({ ok: false, stage: "proxy_not_configured" }, { status: 503, headers });
  }

  let upstream: Response;
  try {
    upstream = await fetch("https://etok.zo.space/api/computer-chat", {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "X-Computer-Web-Secret": proxySecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: "Reply with exactly OK." }),
      signal: AbortSignal.timeout(270_000),
      cache: "no-store",
    });
  } catch {
    return Response.json({ ok: false, stage: "upstream_fetch_failed" }, { status: 502, headers });
  }

  const conversationId = upstream.headers.get("x-conversation-id");
  const contentType = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !upstream.body || !conversationId || !contentType.includes("text/event-stream")) {
    await upstream.body?.cancel().catch(() => undefined);
    return Response.json({ ok: false, stage: "invalid_upstream_response", status: upstream.status }, { status: 502, headers });
  }

  return new Response(withSseKeepalive(upstream.body), {
    status: 200,
    headers: {
      "Cache-Control": "no-cache, no-store, no-transform",
      "Content-Type": contentType,
      "X-Accel-Buffering": "no",
      "X-Conversation-ID": conversationId,
    },
  });
}
