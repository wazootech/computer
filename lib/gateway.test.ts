import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DEEPSEEK_THINKING,
  DEFAULT_GATEWAY_MODEL,
  GATEWAY_BASE_URL,
  modelProviderOptions,
  resolveDeepSeekThinking,
  resolveGatewayCredential,
  resolveGatewayModel,
} from "./gateway.ts";

test("resolves the AI Gateway slug by default", () => {
  assert.equal(DEFAULT_GATEWAY_MODEL, "deepseek/deepseek-v4.1-flash");
  assert.equal(resolveGatewayModel({}), "deepseek/deepseek-v4.1-flash");
  assert.equal(resolveGatewayModel({ COMPUTER_MODEL: "  " }), "deepseek/deepseek-v4.1-flash");
  assert.equal(resolveGatewayModel({ COMPUTER_MODEL: "openai/gpt-5.5" }), "openai/gpt-5.5");
});

test("points at the gateway host, not a provider endpoint", () => {
  assert.equal(GATEWAY_BASE_URL, "https://ai-gateway.vercel.sh");
  assert.equal(GATEWAY_BASE_URL.startsWith("https://"), true);
});

test("resolves the thinking toggle with disabled as the default", () => {
  assert.equal(DEFAULT_DEEPSEEK_THINKING, "disabled");
  assert.equal(resolveDeepSeekThinking({}), "disabled");
  assert.equal(resolveDeepSeekThinking({ DEEPSEEK_THINKING: "  " }), "disabled");
  assert.equal(resolveDeepSeekThinking({ DEEPSEEK_THINKING: "garbage" }), "disabled");
  assert.equal(resolveDeepSeekThinking({ DEEPSEEK_THINKING: "ENABLED" }), "enabled");
  assert.equal(resolveDeepSeekThinking({ DEEPSEEK_THINKING: "disabled" }), "disabled");
});

test("prefers an explicit gateway key over the Vercel OIDC token", () => {
  assert.deepEqual(resolveGatewayCredential({}), null);
  assert.deepEqual(resolveGatewayCredential({ AI_GATEWAY_API_KEY: "   " }), null);
  assert.deepEqual(resolveGatewayCredential({ VERCEL_OIDC_TOKEN: "oidc-token" }), {
    kind: "oidc",
    value: "oidc-token",
  });
  assert.deepEqual(
    resolveGatewayCredential({ AI_GATEWAY_API_KEY: "gateway-key", VERCEL_OIDC_TOKEN: "oidc-token" }),
    { kind: "api-key", value: "gateway-key" },
  );
});

test("pins thinking as a DeepSeek provider option carried on the request", () => {
  assert.deepEqual(modelProviderOptions("disabled"), {
    providerOptions: { deepseek: { thinking: { type: "disabled" } } },
  });
  assert.deepEqual(modelProviderOptions("enabled"), {
    providerOptions: { deepseek: { thinking: { type: "enabled" } } },
  });
});
