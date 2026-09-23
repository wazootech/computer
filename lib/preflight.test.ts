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
    AI_GATEWAY_API_KEY: "gateway-key",
  });

  assert.deepEqual(result, {
    GITHUB_APP_ID: true,
    GITHUB_APP_INSTALLATION_ID: true,
    GITHUB_APP_PRIVATE_KEY: true,
    FACTORY_APPROVAL_SECRET: true,
    GATEWAY_CREDENTIAL: true,
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
  assert.equal(result.model.ok, false);
  assert.match(result.githubApp.error ?? "", /GITHUB_APP_ID/);
  assert.match(result.model.error ?? "", /AI_GATEWAY_API_KEY/);
});

test("proves the installation token carries members read and can read the approver team", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const calls: Array<{ url: string; authorization: string }> = [];
  const responses = [
    new Response(JSON.stringify({ token: "installation-token", permissions: { members: "read", issues: "write" } }), { status: 201 }),
    new Response(JSON.stringify([{ login: "EthanThatOneKid" }]), { status: 200 }),
    new Response(
      JSON.stringify({ id: 915, name: "workspace", full_name: "wazootech/workspace", owner: { login: "wazootech" } }),
      { status: 200 },
    ),
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
    { checkModel: false },
  );

  assert.equal(result.ok, true);
  assert.equal(result.githubApp.ok, true);
  assert.equal(result.githubApp.membersPermission, "read");
  assert.equal(result.githubApp.memberCount, 1);
  assert.match(calls[0]?.url ?? "", /access_tokens$/);
  assert.match(calls[1]?.url ?? "", /teams\/team\/members/);
  assert.match(calls[0]?.authorization ?? "", /^Bearer /);
  assert.equal(calls[1]?.authorization, "Bearer installation-token");
  // The default session repository is `wazootech/workspace`; coverage is proven
  // by resolving it through the same installation token as the other checks.
  assert.equal(result.githubApp.repository.fullName, "wazootech/workspace");
  assert.equal(result.githubApp.repository.ok, true);
  assert.equal(result.githubApp.repository.id, 915);
  assert.match(calls[2]?.url ?? "", /\/repos\/wazootech\/workspace$/);
  assert.equal(calls[2]?.authorization, "Bearer installation-token");
});

test("checks an explicitly named repository and reports a missing one legibly", async () => {
  const responses = [
    new Response(JSON.stringify({ token: "installation-token", permissions: { members: "read", issues: "write" } }), { status: 201 }),
    new Response(JSON.stringify([{ login: "EthanThatOneKid" }]), { status: 200 }),
    new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }),
  ];

  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const urls: string[] = [];

  const result = await runPreflight(
    {
      GITHUB_APP_ID: "4864396",
      GITHUB_APP_INSTALLATION_ID: "159856502",
      GITHUB_APP_PRIVATE_KEY: pem,
      FACTORY_APPROVAL_SECRET: "approval-secret",
    },
    async (input) => {
      urls.push(String(input));
      return responses.shift() as Response;
    },
    { checkModel: false, repository: "wazootech/not-covered" },
  );

  assert.equal(result.githubApp.repository.fullName, "wazootech/not-covered");
  assert.equal(result.githubApp.repository.ok, false);
  assert.equal(result.githubApp.repository.error, "not-covered");
  assert.equal(result.githubApp.ok, false);
  assert.equal(result.ok, false);
  assert.match(urls[2] ?? "", /\/repos\/wazootech\/not-covered$/);
});

test("rejects a malformed repository name instead of asking GitHub about it", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const urls: string[] = [];
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
    async (input) => {
      urls.push(String(input));
      return responses.shift() as Response;
    },
    { checkModel: false, repository: "https://github.com/wazootech/workspace" },
  );

  assert.equal(result.githubApp.repository.fullName, "https://github.com/wazootech/workspace");
  assert.match(result.githubApp.repository.error ?? "", /invalid-format/);
  assert.equal(result.ok, false);
  assert.equal(urls.some((url) => url.includes("/repos/")), false);
});

test("gateway probe sends the default model and thinking pin like the agent wiring", async () => {
  const bodies: string[] = [];
  const result = await runPreflight(
    {
      GITHUB_APP_ID: "4864396",
      GITHUB_APP_INSTALLATION_ID: "159856502",
      GITHUB_APP_PRIVATE_KEY: "not-a-key",
      FACTORY_APPROVAL_SECRET: "approval-secret",
      AI_GATEWAY_API_KEY: "gateway-key",
    },
    async (_input, init) => {
      if (init?.body != null) bodies.push(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 });
    },
  );

  const probe = bodies.map((b) => { try { return JSON.parse(b); } catch { return null; } }).find(
    (b) => b && typeof b === "object" && "model" in b,
  ) as { model: string; deepseek?: { thinking?: { type: string } } } | undefined;
  assert.ok(probe, "gateway probe body captured");
  assert.equal(probe.model, "deepseek/deepseek-v4.1-flash");
  assert.deepEqual(probe.deepseek?.thinking, { type: "disabled" });
  assert.equal(result.model.id, "deepseek/deepseek-v4.1-flash");
});

test("gateway probe honors COMPUTER_MODEL and DEEPSEEK_THINKING overrides", async () => {
  const bodies: string[] = [];
  const result = await runPreflight(
    {
      GITHUB_APP_ID: "4864396",
      GITHUB_APP_INSTALLATION_ID: "159856502",
      GITHUB_APP_PRIVATE_KEY: "not-a-key",
      FACTORY_APPROVAL_SECRET: "approval-secret",
      AI_GATEWAY_API_KEY: "gateway-key",
      COMPUTER_MODEL: "deepseek/deepseek-v4.1-flash",
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
  assert.ok(probe, "gateway probe body captured");
  assert.equal(probe.model, "deepseek/deepseek-v4.1-flash");
  assert.deepEqual((probe as unknown as { deepseek?: { thinking?: { type: string } } }).deepseek?.thinking, { type: "enabled" });
  assert.equal(result.model.id, "deepseek/deepseek-v4.1-flash");
});

test("can skip the model check while validating GitHub credentials", async () => {
  const result = await runPreflight(
    {
      GITHUB_APP_ID: "4864396",
      GITHUB_APP_INSTALLATION_ID: "159856502",
      GITHUB_APP_PRIVATE_KEY: "not-a-key",
      FACTORY_APPROVAL_SECRET: "approval-secret",
    },
    async () => new Response("", { status: 500 }),
    { checkModel: false },
  );

  assert.equal(result.model.ok, true);
  assert.equal(result.model.skipped, true);
  assert.equal(result.githubApp.ok, false);
});

test("names the credential-path failure instead of reporting a bare status", async () => {
  const unauthorized = await runPreflight(
    {
      GITHUB_APP_ID: "4864396",
      GITHUB_APP_INSTALLATION_ID: "159856502",
      GITHUB_APP_PRIVATE_KEY: "not-a-key",
      FACTORY_APPROVAL_SECRET: "approval-secret",
      AI_GATEWAY_API_KEY: "revoked-key",
    },
    async () => new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 }),
  );
  assert.equal(unauthorized.model.ok, false);
  assert.equal(unauthorized.model.status, 401);
  assert.match(unauthorized.model.error ?? "", /credential/);

  const forbidden = await runPreflight(
    {
      GITHUB_APP_ID: "4864396",
      GITHUB_APP_INSTALLATION_ID: "159856502",
      GITHUB_APP_PRIVATE_KEY: "not-a-key",
      FACTORY_APPROVAL_SECRET: "approval-secret",
      AI_GATEWAY_API_KEY: "free-tier-key",
    },
    async () =>
      new Response(
        JSON.stringify({
          error: { message: "Free tier users do not have access to this model." },
        }),
        { status: 403 },
      ),
  );
  assert.equal(forbidden.model.ok, false);
  assert.equal(forbidden.model.status, 403);
  assert.match(forbidden.model.error ?? "", /credits/);
});

test("accepts the Vercel OIDC token when no explicit gateway key is set", async () => {
  const authorizations: string[] = [];
  await runPreflight(
    {
      GITHUB_APP_ID: "4864396",
      GITHUB_APP_INSTALLATION_ID: "159856502",
      GITHUB_APP_PRIVATE_KEY: "not-a-key",
      FACTORY_APPROVAL_SECRET: "approval-secret",
      VERCEL_OIDC_TOKEN: "oidc-token",
    },
    async (_input, init) => {
      const headers = new Headers(init?.headers);
      if (headers.has("authorization")) authorizations.push(headers.get("authorization") ?? "");
      if (String(init?.body).includes("model")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 });
      }
      return new Response("{}\n", { status: 200 });
    },
  );

  assert.ok(authorizations.includes("Bearer oidc-token"), "gateway probe used the OIDC token");
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
  }, async () => { throw new Error("network should not be called"); }, { checkModel: false });
  assert.equal(result.factoryLabels.ok, false);
  assert.match(result.factoryLabels.errors.join(" "), /differ|unique/u);
  assert.equal(result.ok, false);
});
