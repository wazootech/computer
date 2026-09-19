import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { runPreflight, summarizeSecrets, validateAcceptanceTarget } from "./preflight.ts";

test("summarizes secret presence without returning secret values", () => {
  const result = summarizeSecrets({
    GITHUB_APP_ID: "4864396",
    GITHUB_APP_INSTALLATION_ID: "159856502",
    GITHUB_APP_PRIVATE_KEY: "private-key",
    FACTORY_APPROVAL_SECRET: "approval-secret",
    DEEPSEEK_API_KEY: "deepseek-key",
  });

  assert.deepEqual(result, {
    GITHUB_APP_ID: true,
    GITHUB_APP_INSTALLATION_ID: true,
    GITHUB_APP_PRIVATE_KEY: true,
    FACTORY_APPROVAL_SECRET: true,
    DEEPSEEK_API_KEY: true,
  });
});

test("reports missing runtime credentials without making network requests", async () => {
  let fetchCalls = 0;
  const result = await runPreflight({}, async () => {
    fetchCalls += 1;
    throw new Error("fetch should not be called");
  });

  assert.equal(result.ok, false);
  assert.equal(fetchCalls, 0);
  assert.equal(result.githubApp.ok, false);
  assert.equal(result.deepSeek.ok, false);
  assert.match(result.githubApp.error ?? "", /GITHUB_APP_ID/);
  assert.match(result.deepSeek.error ?? "", /DEEPSEEK_API_KEY/);
});

test("proves the installation token carries members read and can read the approver team", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const calls: Array<{ url: string; authorization: string }> = [];
  const responses = [
    new Response(JSON.stringify({ token: "installation-token", permissions: { members: "read" } }), { status: 201 }),
    new Response(JSON.stringify([{ login: "EthanThatOneKid" }]), { status: 200 }),
  ];

  const result = await runPreflight(
    {
      GITHUB_APP_ID: "4864396",
      GITHUB_APP_INSTALLATION_ID: "159856502",
      GITHUB_APP_PRIVATE_KEY: pem,
      FACTORY_APPROVAL_SECRET: "approval-secret",
    },
    async (input, init) => {
      calls.push({
        url: String(input),
        authorization: String(new Headers(init?.headers).get("authorization")),
      });
      return responses.shift() as Response;
    },
    { checkDeepSeek: false },
  );

  assert.equal(result.ok, true);
  assert.equal(result.githubApp.ok, true);
  assert.equal(result.githubApp.membersPermission, "read");
  assert.equal(result.githubApp.memberCount, 1);
  assert.match(calls[0]?.url ?? "", /access_tokens$/);
  assert.match(calls[1]?.url ?? "", /teams\/team\/members/);
  assert.match(calls[0]?.authorization ?? "", /^Bearer /);
  assert.equal(calls[1]?.authorization, "Bearer installation-token");
});

test("deepseek probe sends the default model and thinking pin like the agent wiring", async () => {
  const bodies: string[] = [];
  const result = await runPreflight(
    {
      GITHUB_APP_ID: "4864396",
      GITHUB_APP_INSTALLATION_ID: "159856502",
      GITHUB_APP_PRIVATE_KEY: "not-a-key",
      FACTORY_APPROVAL_SECRET: "approval-secret",
      DEEPSEEK_API_KEY: "deepseek-key",
    },
    async (_input, init) => {
      if (String(init?.body).includes("chat/completions") || init?.body != null) {
        bodies.push(String(init?.body));
      }
      if (String(init?.body).includes("deepseek")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 });
      }
      return new Response("{}", { status: 500 });
    },
  );

  const probe = bodies.find((b) => b.includes("chat/completions") || b.includes("deepseek"));
  assert.ok(probe, "deepseek probe body captured");
  const parsed = JSON.parse(probe) as { model: string; thinking?: { type: string } };
  assert.equal(parsed.model, "deepseek-flash");
  assert.deepEqual(parsed.thinking, { type: "disabled" });
  assert.equal(result.deepSeek.model, "deepseek-flash");
});

test("deepseek probe honors DEEPSEEK_MODEL and DEEPSEEK_THINKING overrides", async () => {
  const bodies: string[] = [];
  const result = await runPreflight(
    {
      GITHUB_APP_ID: "4864396",
      GITHUB_APP_INSTALLATION_ID: "159856502",
      GITHUB_APP_PRIVATE_KEY: "not-a-key",
      FACTORY_APPROVAL_SECRET: "approval-secret",
      DEEPSEEK_API_KEY: "deepseek-key",
      DEEPSEEK_MODEL: "deepseek-v4-flash",
      DEEPSEEK_THINKING: "enabled",
    },
    async (_input, init) => {
      if (init?.body != null) bodies.push(String(init.body));
      if (String(init?.body).includes("model")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 });
      }
      return new Response("{}", { status: 500 });
    },
  );

  const probe = bodies.map((b) => { try { return JSON.parse(b); } catch { return null; } }).find(
    (b) => b && typeof b === "object" && "model" in b,
  ) as { model: string; thinking?: { type: string } } | undefined;
  assert.ok(probe, "deepseek probe body captured");
  assert.equal(probe.model, "deepseek-v4-flash");
  assert.deepEqual(probe.thinking, { type: "enabled" });
  assert.equal(result.deepSeek.model, "deepseek-v4-flash");
});

test("can skip the DeepSeek check while validating GitHub credentials", async () => {
  const result = await runPreflight(
    {
      GITHUB_APP_ID: "4864396",
      GITHUB_APP_INSTALLATION_ID: "159856502",
      GITHUB_APP_PRIVATE_KEY: "not-a-key",
      FACTORY_APPROVAL_SECRET: "approval-secret",
    },
    async () => new Response("", { status: 500 }),
    { checkDeepSeek: false },
  );

  assert.equal(result.deepSeek.ok, true);
  assert.equal(result.deepSeek.skipped, true);
  assert.equal(result.githubApp.ok, false);
});

test("validates an explicitly disposable acceptance target", () => {
  const valid = validateAcceptanceTarget({ repository: "wazootech/wazoo-console", issueNumber: 84, baseSha: "a".repeat(40), worktree: "/tmp/factory", disposable: true });
  assert.deepEqual(valid, { ok: true, errors: [] });

  const invalid = validateAcceptanceTarget({ repository: "not-a-repository", issueNumber: 0, baseSha: "bad", worktree: "", disposable: false });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors.length, 5);
});

test("preflight rejects conflicting factory label configuration", async () => {
  const result = await runPreflight({
    FACTORY_APPROVAL_SECRET: "approval-secret",
    FACTORY_CANDIDATE_LABEL: "same",
    FACTORY_PROMOTED_LABEL: "same",
  }, async () => { throw new Error("network should not be called"); }, { checkDeepSeek: false });
  assert.equal(result.factoryLabels.ok, false);
  assert.match(result.factoryLabels.errors.join(" "), /differ|unique/u);
  assert.equal(result.ok, false);
});
