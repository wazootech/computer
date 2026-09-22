/**
 * Model routing for the Computer agent.
 *
 * Model default: `deepseek/deepseek-v4.1-flash` is the AI Gateway id for
 * DeepSeek-V4.1-Flash. It routes through the Vercel AI Gateway, which resolves
 * the slug to one of its upstream providers and fails the request over to
 * another provider serving the same model when one provider is unavailable.
 * `COMPUTER_MODEL` overrides the slug.
 *
 * Why the gateway rather than a direct provider: the previous wiring built a
 * direct `createOpenAICompatible` client against `api.deepseek.com` with a
 * single `DEEPSEEK_API_KEY`. One revoked key then took the whole agent down
 * with a 401, because there was no second path to the model. A gateway slug
 * moves provider choice and retry out of this repo, and the credential the
 * runtime needs (`AI_GATEWAY_API_KEY`, or Vercel's own `VERCEL_OIDC_TOKEN`)
 * is no longer tied to one upstream provider account.
 *
 * Thinking-mode pin: DeepSeek-V4.1-Flash defaults to thinking mode ON. The
 * agent loop is a tool-calling pipeline, so leaving the default in place would
 * silently change agent behavior (CoT output, the reasoning_content
 * pass-back contract for tool calls, slower turns). The pin now travels as a
 * normal provider option (`providerOptions.deepseek.thinking`) instead of a
 * fetch middleware that rewrote the request body, and `DEEPSEEK_THINKING`
 * still selects the value.
 */

export const DEFAULT_GATEWAY_MODEL = "deepseek/deepseek-v4.1-flash";

export const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";

export type DeepSeekThinking = "enabled" | "disabled";

export const DEFAULT_DEEPSEEK_THINKING: DeepSeekThinking = "disabled";

export function resolveGatewayModel(env: {
  COMPUTER_MODEL?: string | undefined;
}): string {
  return env.COMPUTER_MODEL?.trim() || DEFAULT_GATEWAY_MODEL;
}

export function resolveDeepSeekThinking(env: {
  DEEPSEEK_THINKING?: string | undefined;
}): DeepSeekThinking {
  const raw = env.DEEPSEEK_THINKING?.trim().toLowerCase();
  if (raw === "enabled" || raw === "disabled") return raw;
  return DEFAULT_DEEPSEEK_THINKING;
}

/**
 * The gateway credential, in eve's resolution order. `AI_GATEWAY_API_KEY` is an
 * explicit gateway key; `VERCEL_OIDC_TOKEN` is injected by Vercel into
 * deployments and is accepted by the gateway in its place.
 */
export function resolveGatewayCredential(env: {
  AI_GATEWAY_API_KEY?: string | undefined;
  VERCEL_OIDC_TOKEN?: string | undefined;
}): { kind: "api-key" | "oidc"; value: string } | null {
  const apiKey = env.AI_GATEWAY_API_KEY?.trim();
  if (apiKey) return { kind: "api-key", value: apiKey };
  const oidc = env.VERCEL_OIDC_TOKEN?.trim();
  if (oidc) return { kind: "oidc", value: oidc };
  return null;
}

/**
 * Provider options pinned on every model call, mirroring the `thinking` field
 * the agent would otherwise take the provider default for.
 */
export function modelProviderOptions(thinking: DeepSeekThinking): {
  providerOptions: {
    deepseek: { thinking: { type: DeepSeekThinking } };
  };
} {
  return { providerOptions: { deepseek: { thinking: { type: thinking } } } };
}
