import {
  modelProviderOptions,
  resolveDeepSeekThinking,
  resolveGatewayModel,
} from "../../lib/gateway.ts";

const model = resolveGatewayModel({ COMPUTER_MODEL: process.env.COMPUTER_MODEL });

/**
 * Shared request-shape options for every role. All six roles run the same
 * gateway model, so they must share the thinking-mode pin; a role that omitted
 * it would silently run with thinking ON.
 */
export const MODEL_OPTIONS = modelProviderOptions(
  resolveDeepSeekThinking({ DEEPSEEK_THINKING: process.env.DEEPSEEK_THINKING }),
);

export const MODELS = {
  analyst: model,
  classifier: model,
  implementer: model,
  orchestrator: model,
  researcher: model,
  reviewer: model,
} as const;

export type FactoryAgent = keyof typeof MODELS;
