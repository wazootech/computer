import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { runPreflight, summarizeSecrets } from "./preflight.ts";

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
