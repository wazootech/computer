import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_DEEPSEEK_THINKING,
  resolveDeepSeekModel,
  resolveDeepSeekThinking,
  withDeepSeekThinking,
} from "./deepseek.ts";

test("resolves the canonical deepseek-flash default", () => {
  assert.equal(DEFAULT_DEEPSEEK_MODEL, "deepseek-flash");
  assert.equal(resolveDeepSeekModel({}), "deepseek-flash");
  assert.equal(resolveDeepSeekModel({ DEEPSEEK_MODEL: "  " }), "deepseek-flash");
  assert.equal(resolveDeepSeekModel({ DEEPSEEK_MODEL: "deepseek-v4-pro" }), "deepseek-v4-pro");
});

test("resolves the thinking toggle with disabled as the default", () => {
  assert.equal(DEFAULT_DEEPSEEK_THINKING, "disabled");
  assert.equal(resolveDeepSeekThinking({}), "disabled");
  assert.equal(resolveDeepSeekThinking({ DEEPSEEK_THINKING: "  " }), "disabled");
  assert.equal(resolveDeepSeekThinking({ DEEPSEEK_THINKING: "garbage" }), "disabled");
  assert.equal(resolveDeepSeekThinking({ DEEPSEEK_THINKING: "ENABLED" }), "enabled");
  assert.equal(resolveDeepSeekThinking({ DEEPSEEK_THINKING: "disabled" }), "disabled");
});

test("withDeepSeekThinking injects the top-level toggle into chat bodies", async () => {
  let captured: string | undefined;
  const wrapped = withDeepSeekThinking("disabled", async (_input, init) => {
    captured = String(init?.body);
    return new Response("{}", { status: 200 });
  });

  await wrapped("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-flash",
      messages: [{ role: "user", content: "hi" }],
    }),
  });

  const body = JSON.parse(captured ?? "{}") as {
    model: string;
    thinking?: { type: string };
  };
  assert.equal(body.model, "deepseek-flash");
  assert.deepEqual(body.thinking, { type: "disabled" });
});

test("withDeepSeekThinking leaves an explicitly-set thinking key untouched", async () => {
  let captured: string | undefined;
  const wrapped = withDeepSeekThinking("disabled", async (_input, init) => {
    captured = String(init?.body);
    return new Response("{}", { status: 200 });
  });

  await wrapped("https://api.deepseek.com/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model: "deepseek-flash",
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "enabled" },
    }),
  });

  const body = JSON.parse(captured ?? "{}") as { thinking?: { type: string } };
  assert.deepEqual(body.thinking, { type: "enabled" });
});

test("withDeepSeekThinking passes through non-chat and non-JSON bodies", async () => {
  const seen: Array<string | undefined> = [];
  const wrapped = withDeepSeekThinking("disabled", async (_input, init) => {
    seen.push(init?.body == null ? undefined : String(init.body));
    return new Response("{}", { status: 200 });
  });

  await wrapped("https://example.com", { method: "POST", body: "not-json" });
  await wrapped("https://example.com", { method: "POST" });
  await wrapped("https://example.com", { method: "GET", body: "{}" });
  await wrapped("https://example.com", {
    method: "POST",
    body: JSON.stringify({ prompt: "completion-style, no messages array" }),
  });

  assert.equal(seen[0], "not-json");
  assert.equal(seen[1], undefined);
  assert.equal(seen[2], "{}");
  assert.equal(JSON.parse(seen[3] ?? "{}").thinking, undefined);
});
