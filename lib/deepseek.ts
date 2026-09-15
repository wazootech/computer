/**
 * Shared DeepSeek wiring for the Computer agent.
 *
 * Model default: `deepseek-flash` is the canonical API name for
 * DeepSeek-V4.1-Flash (api-docs.deepseek.com, 2026-09-10 release). The old
 * `deepseek-v4-flash` model is retired; DeepSeek only temporarily routes that
 * legacy name to V4.1-Flash, so defaulting to it would break when the alias
 * is pulled. `DEEPSEEK_MODEL` still wins when set.
 *
 * Thinking-mode pin: DeepSeek-V4.1-Flash defaults to thinking mode ON. The
 * agent loop is a tool-calling pipeline; leaving the default in place would
 * silently change agent behavior (CoT output, reasoning_content pass-back
 * contract for tool calls, slower/loopier turns), so every request pins the
 * OpenAI-format toggle to a value chosen by `DEEPSEEK_THINKING` (default
 * "disabled", matching the previous generation's behavior).
 *
 * The toggle is injected top-level in the request body via a fetch
 * middleware (the seam the AI SDK openai-compatible provider gives us): its
 * provider-options schema strips unknown keys, so `thinking` cannot travel
 * through providerOptions, and the raw top-level param is DeepSeek-specific
 * (mirrors the raw-fetch client proven in wazoo-memorybench).
 */

export const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash";

export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export type DeepSeekThinking = "enabled" | "disabled";

export const DEFAULT_DEEPSEEK_THINKING: DeepSeekThinking = "disabled";

export function resolveDeepSeekModel(env: {
  DEEPSEEK_MODEL?: string | undefined;
}): string {
  return env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL;
}

export function resolveDeepSeekThinking(env: {
  DEEPSEEK_THINKING?: string | undefined;
}): DeepSeekThinking {
  const raw = env.DEEPSEEK_THINKING?.trim().toLowerCase();
  if (raw === "enabled" || raw === "disabled") return raw;
  return DEFAULT_DEEPSEEK_THINKING;
}

/**
 * Wraps fetch so every JSON chat-completions body carries DeepSeek's
 * top-level thinking toggle. Non-JSON bodies (and non-POST requests) pass
 * through untouched; an explicitly-present `thinking` key in the original
 * body wins over the pin.
 */
export function withDeepSeekThinking(
  thinking: DeepSeekThinking,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    if (init?.method?.toUpperCase() === "POST" && init.body != null) {
      try {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (Array.isArray(body.messages)) {
          body.thinking ??= { type: thinking };
          init = { ...init, body: JSON.stringify(body) };
        }
      } catch {
        // Not JSON (or streamed body): pass through unmodified.
      }
    }
    return fetchImpl(input, init);
  };
}
