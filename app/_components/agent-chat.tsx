"use client";

import { AlertCircleIcon, ArrowUpIcon, BrainIcon, LoaderCircleIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationTopFade,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { consumeZoSse } from "@/lib/zo-sse";

const AGENT_NAME = "Computer";
const MAX_LOCAL_MESSAGES = 100;

export function AgentChat({
  sessionId,
  sessionless = false,
  userId,
}: {
  readonly sessionId?: string;
  readonly sessionless?: boolean;
  readonly userId: string;
}) {
  const [activeSessionId, setActiveSessionId] = useState(sessionId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [hydratedKey, setHydratedKey] = useState<string>();
  const busyRef = useRef(false);
  const storageKey = activeSessionId
    ? `computer:web-chat:v1:${userId}:${activeSessionId}`
    : undefined;

  useEffect(() => {
    if (!storageKey || hydratedKey === storageKey) return;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (isChatMessageArray(parsed)) setMessages(parsed.slice(-MAX_LOCAL_MESSAGES));
      }
    } catch {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        return;
      }
    }
    setHydratedKey(storageKey);
  }, [hydratedKey, storageKey]);

  useEffect(() => {
    if (!storageKey || hydratedKey !== storageKey || messages.length === 0) return;
    const serialized = JSON.stringify(messages.slice(-MAX_LOCAL_MESSAGES));
    const save = () => {
      try {
        localStorage.setItem(storageKey, serialized);
      } catch {
        return;
      }
    };
    const timer = window.setTimeout(save, 300);
    window.addEventListener("pagehide", save);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", save);
    };
  }, [hydratedKey, messages, storageKey]);

  const submit = async () => {
    const input = draft.trim();
    if (!input || busyRef.current) return;

    const nextSessionId = activeSessionId ?? crypto.randomUUID();
    if (activeSessionId === undefined) {
      setActiveSessionId(nextSessionId);
      History.prototype.replaceState.call(
        window.history,
        window.history.state,
        "",
        `/s/${encodeURIComponent(nextSessionId)}`,
      );
    }

    busyRef.current = true;
    setIsStreaming(true);
    setDraft("");
    setErrorMessage(undefined);

    const assistantId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content: input },
      { id: assistantId, role: "assistant", content: "" },
    ]);

    try {
      const response = await fetch(`/api/chat/${encodeURIComponent(nextSessionId)}`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input }),
      });
      if (!response.ok) throw new Error(await readError(response));
      if (!response.body) throw new Error("Computer returned no response stream.");

      await consumeZoSse(response.body, (text) => {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, content: message.content + text } : message,
          ),
        );
      });
      setMessages((current) => current.filter((message) => message.content.length > 0));
    } catch (error) {
      setMessages((current) =>
        current.filter((message) => message.id !== assistantId || message.content.length > 0),
      );
      setErrorMessage(error instanceof Error ? error.message : "Computer could not complete the response.");
    } finally {
      busyRef.current = false;
      setIsStreaming(false);
    }
  };

  const showConversationLayout =
    sessionless || activeSessionId !== undefined || messages.length > 0 || errorMessage !== undefined;
  const isEmpty = messages.length === 0;
  const pendingAssistant =
    isStreaming && messages.at(-1)?.role === "assistant" && messages.at(-1)?.content === "";

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {showConversationLayout ? <ChatHeader canStartNewChat={activeSessionId !== undefined} /> : null}

      {showConversationLayout ? (
        <Conversation
          className="min-h-0 flex-1"
          initial={sessionId === undefined ? undefined : false}
          resize={activeSessionId === undefined ? "smooth" : "instant"}
          scrollRestorationKey={
            isEmpty || activeSessionId === undefined
              ? undefined
              : `computer:web-chat-scroll:${activeSessionId}`
          }
        >
          <ConversationTopFade className="top-14" />
          <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 pt-20 pb-36 sm:px-6">
            {messages.map((message) =>
              message.content.length === 0 ? null : (
                <Message from={message.role} key={message.id}>
                  <MessageContent>
                    {message.role === "assistant" ? (
                      <MessageResponse isAnimating={isStreaming && message === messages.at(-1)}>
                        {message.content}
                      </MessageResponse>
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    )}
                  </MessageContent>
                </Message>
              ),
            )}
            {pendingAssistant ? <PendingThinking /> : null}
            {errorMessage ? <ErrorMessage message={errorMessage} /> : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      ) : null}

      <div
        className={cn(
          "mx-auto w-full px-4 sm:px-6",
          showConversationLayout
            ? "fixed bottom-0 left-1/2 z-20 max-w-3xl -translate-x-1/2 bg-gradient-to-t from-background via-background to-transparent pt-4 pb-6"
            : "flex max-w-xl flex-1 flex-col items-center justify-center gap-8 pb-[10vh]",
        )}
      >
        {showConversationLayout ? null : (
          <div className="flex flex-col items-center gap-3 text-center">
            <h1 className="font-medium text-5xl tracking-tighter">{AGENT_NAME}</h1>
          </div>
        )}
        <form
          className="w-full rounded-2xl border bg-background p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex items-end gap-2">
            <textarea
              aria-label="Message Computer"
              className="max-h-48 min-h-12 flex-1 resize-y bg-transparent px-3 py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isStreaming}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder="Send a message…"
              value={draft}
            />
            <Button
              aria-label={isStreaming ? "Computer is responding" : "Send message"}
              className="mb-1 size-9 shrink-0 rounded-full"
              disabled={isStreaming || draft.trim().length === 0}
              size="icon"
              type="submit"
            >
              {isStreaming ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ArrowUpIcon className="size-4" />}
            </Button>
          </div>
          <p className="px-3 pb-1 text-muted-foreground text-xs">
            Text only. File uploads, tool approvals, and mid-turn steering are disabled.
          </p>
        </form>
      </div>
    </main>
  );
}

function ChatHeader({ canStartNewChat }: { readonly canStartNewChat: boolean }) {
  return (
    <header className="pointer-events-none fixed top-0 right-0 left-0 z-20 h-14">
      <div className="relative mx-auto flex h-full w-full max-w-3xl items-center justify-center bg-background px-24">
        <span className="truncate text-muted-foreground text-sm">{AGENT_NAME}</span>
        {canStartNewChat ? (
          <Button
            aria-label="Start a new chat"
            className="pointer-events-auto fixed top-3 right-6 pr-4"
            onClick={() => window.location.assign("/s")}
            size="sm"
            type="button"
            variant="ghost"
          >
            <PlusIcon className="size-4" />
            <span className="hidden font-normal text-sm sm:inline">New chat</span>
          </Button>
        ) : null}
      </div>
    </header>
  );
}

function PendingThinking() {
  return (
    <Message aria-live="polite" from="assistant">
      <MessageContent>
        <div className="mb-4 flex w-full items-center gap-2 text-muted-foreground text-sm">
          <BrainIcon className="size-4" />
          <Shimmer duration={1}>Thinking</Shimmer>
        </div>
      </MessageContent>
    </Message>
  );
}

function ErrorMessage({ message }: { readonly message: string }) {
  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent>
        <div
          className="flex w-full items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm"
          role="alert"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">Request failed</p>
            <p className="mt-0.5 text-muted-foreground">{message}</p>
          </div>
        </div>
      </MessageContent>
    </Message>
  );
}

function isChatMessageArray(value: unknown): value is ChatMessage[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof item.id === "string" &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string",
    )
  );
}

async function readError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string") {
      return (body as { error: string }).error;
    }
  } catch {
    return "Computer could not complete the response.";
  }
  return "Computer could not complete the response.";
}

type ChatMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
};
