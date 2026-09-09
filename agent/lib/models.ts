import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const deepseek = createOpenAICompatible({
  apiKey: process.env.DEEPSEEK_API_KEY ?? "missing-deepseek-key",
  baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  name: "deepseek",
});

const model = deepseek(process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash");

export const MODELS = {
  analyst: model,
  classifier: model,
  implementer: model,
  orchestrator: model,
  researcher: model,
  reviewer: model,
} as const;

export type FactoryAgent = keyof typeof MODELS;
