import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/computer-chat-origin";
import { signComputerChatSession, verifyComputerChatSession } from "@/lib/computer-chat-session";

export const runtime = "nodejs";

const ZO_CHAT_PROXY_URL = "https://etok.zo.space/api/computer-chat";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const MAX_INPUT_CHARACTERS = 30_000;

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly sessionId: string }> },
): Promise<Response> {
  if (!isSameOriginRequest(request)) return Response.json({ error: "Forbidden." }, { status: 403 });

  const { sessionId } = await context.params;
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(sessionId)) {
    return Response.json({ error: "Invalid chat session." }, { status: 400 });
  }

  const userId = await getUserId(request);
  if (userId === null) return Response.json({ error: "Sign-in required." }, { status: 401 });

  const proxySecret = process.env.COMPUTER_WEB_SECRET;
  const sessionSecret = process.env.COMPUTER_CHAT_SESSION_SECRET;
  if (
    !proxySecret ||
    Buffer.byteLength(proxySecret, "utf8") < 32 ||
    !sessionSecret ||
    Buffer.byteLength(sessionSecret, "utf8") < 32
  ) {
    return Response.json({ error: "The Computer chat service is not configured." }, { status: 503 });
  }

  let input: string;
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || typeof (body as { input?: unknown }).input !== "string") {
      return Response.json({ error: "Message must be text." }, { status: 400 });
    }
    input = (body as { input: string }).input.trim();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (input.length === 0 || input.length > MAX_INPUT_CHARACTERS) {
    return Response.json({ error: "Message must be between 1 and 30,000 characters." }, { status: 400 });
  }

  const cookieName = getCookieName(sessionId);
  const existingToken = (await cookies()).get(cookieName)?.value;
  const existingSession = existingToken
    ? verifyComputerChatSession(existingToken, sessionSecret, { userId, sessionId })
    : null;
  if (existingToken && existingSession === null) {
    return Response.json({ error: "This chat session is unavailable. Start a new chat." }, { status: 409 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(ZO_CHAT_PROXY_URL, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${proxySecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input,
        ...(existingSession === null ? {} : { conversation_id: existingSession.conversationId }),
      }),
      signal: request.signal,
    });
  } catch {
    return Response.json({ error: "The Computer chat service is unavailable." }, { status: 502 });
  }

  if (!upstream.ok) {
    return Response.json({ error: "The Computer chat service is unavailable." }, { status: 502 });
  }
  if (!upstream.body) {
    return Response.json({ error: "The Computer chat service returned no stream." }, { status: 502 });
  }

  const conversationId = upstream.headers.get("x-conversation-id");
  if (!conversationId || conversationId.length > 512) {
    await upstream.body.cancel();
    return Response.json({ error: "The Computer chat service returned no session ID." }, { status: 502 });
  }

  let ticket: string;
  try {
    ticket = signComputerChatSession({ userId, sessionId, conversationId }, sessionSecret);
  } catch {
    await upstream.body.cancel();
    return Response.json({ error: "The Computer chat service is not configured." }, { status: 503 });
  }

  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookie = `${cookieName}=${ticket}; HttpOnly; SameSite=Lax; Path=/api/chat/${sessionId}; Max-Age=${COOKIE_MAX_AGE_SECONDS}${secure}`;
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": upstream.headers.get("content-type") ?? "text/event-stream; charset=utf-8",
      "Set-Cookie": cookie,
      "X-Accel-Buffering": "no",
    },
  });
}

async function getUserId(request: Request): Promise<string | null> {
  if (process.env.NODE_ENV === "development") return "development";
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    return session?.user.id ?? null;
  } catch {
    return null;
  }
}

function getCookieName(sessionId: string): string {
  return `computer_chat_${sessionId.replaceAll("-", "")}`;
}

