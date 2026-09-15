import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import {
  resolveDeepSeekModel,
  resolveDeepSeekThinking,
  withDeepSeekThinking,
} from "../../lib/deepseek.ts";

const deepseek = createOpenAICompatible({
  apiKey: process.env.DEEPSEEK_API_KEY ?? "missing-deepseek-key",
  baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  name: "deepseek",
  // DeepSeek-V4.1-Flash defaults to thinking mode ON; pin the toggle on every
  // request body so the tool-calling agent loop's behavior is explicit and
  // stable (DEEPSEEK_THINKING=enabled opts back in). The openai-compatible
  // provider strips unknown provider options, so the top-level param is
  // injected at the fetch seam.
  fetch: withDeepSeekThinking(
    resolveDeepSeekThinking({ DEEPSEEK_THINKING: process.env.DEEPSEEK_THINKING }),
  ),
});

const model = deepseek(resolveDeepSeekModel({ DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL }));

export const MODELS = {
  analyst: model,
  classifier: model,
  implementer: model,
  orchestrator: model,
  researcher: model,
  reviewer: model,
} as const;

export type FactoryAgent = keyof typeof MODELS;
