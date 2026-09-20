import assert from "node:assert/strict";
import test from "node:test";
import type { SessionAuthContext } from "eve/context";
import {
  DEFAULT_SESSION_REPOSITORY,
  SESSION_REPOSITORY_HEADER,
  attachSessionRepository,
  createSessionRepositoryResolver,
  defaultSessionRepository,
  parseRepositoryFullName,
  requestedSessionRepository,
  resolveInstallationRepository,
  sessionRepositoryFailure,
  sessionRepositoryNotice,
  type SessionRepositoryResolver,
} from "../agent/lib/github/session-attachment.ts";
import { repositoryTargetFromAuth } from "../agent/lib/github/repository-target.ts";

const target = { fullName: "wazootech/computer", id: 42, name: "computer", owner: "wazootech" };

function userAuth(attributes: Record<string, string> = {}): SessionAuthContext {
  return { attributes, authenticator: "better-auth:vercel", principalId: "user-1", principalType: "user" };
}

function repositoryResponse(): Response {
  return new Response(
    JSON.stringify({ id: target.id, name: target.name, full_name: target.fullName, owner: { login: target.owner } }),
    { status: 200 },
  );
}

test("parses only plain owner/name repository names", () => {
  assert.equal(parseRepositoryFullName("wazootech/workspace"), "wazootech/workspace");
  assert.equal(parseRepositoryFullName("  wazootech/workspace  "), "wazootech/workspace");
  assert.equal(parseRepositoryFullName("Wazootech/computer.ts"), "Wazootech/computer.ts");
  assert.equal(parseRepositoryFullName("https://github.com/wazootech/workspace"), null);
  assert.equal(parseRepositoryFullName("wazootech"), null);
  assert.equal(parseRepositoryFullName("wazootech/workspace/issues"), null);
  assert.equal(parseRepositoryFullName(""), null);
  assert.equal(parseRepositoryFullName(null), null);
});

test("defaults to the federation manifest repo and honors the deployment override", () => {
  assert.equal(defaultSessionRepository({}), DEFAULT_SESSION_REPOSITORY);
  assert.equal(defaultSessionRepository({ COMPUTER_SESSION_REPOSITORY: "wazootech/computer" }), "wazootech/computer");
  assert.equal(defaultSessionRepository({ COMPUTER_SESSION_REPOSITORY: "not-a-repo" }), DEFAULT_SESSION_REPOSITORY);
});

test("a request header names the repository and a malformed header fails closed", () => {
  const withHeader = new Request("https://example.com/eve/v1/session", {
    headers: { [SESSION_REPOSITORY_HEADER]: "wazootech/computer" },
    method: "POST",
  });
  assert.deepEqual(requestedSessionRepository(withHeader, {}), { ok: true, fullName: "wazootech/computer" });

  const malformed = new Request("https://example.com/eve/v1/session", {
    headers: { [SESSION_REPOSITORY_HEADER]: "wazootech workspace" },
    method: "POST",
  });
  assert.deepEqual(requestedSessionRepository(malformed, {}), { ok: false, failure: "invalid-format" });

  const bare = new Request("https://example.com/eve/v1/session", { method: "POST" });
  assert.deepEqual(requestedSessionRepository(bare, { COMPUTER_SESSION_REPOSITORY: "wazootech/wiki" }), {
    ok: true,
    fullName: "wazootech/wiki",
  });
});

test("resolves a repository through the installation token and reports coverage failures", async () => {
  const calls: Array<{ url: string; authorization: string }> = [];
  const resolved = await resolveInstallationRepository({
    fullName: "wazootech/computer",
    token: "installation-token",
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), authorization: String(new Headers(init?.headers).get("authorization")) });
      return repositoryResponse();
    },
  });
  assert.deepEqual(resolved, { ok: true, target });
  assert.equal(calls[0]?.url, "https://api.github.com/repos/wazootech/computer");
  assert.equal(calls[0]?.authorization, "Bearer installation-token");

  const missing = await resolveInstallationRepository({
    fullName: "wazootech/private",
    token: "installation-token",
    fetchImpl: async () => new Response("{}", { status: 404 }),
  });
  assert.deepEqual(missing, { ok: false, failure: "not-covered" });

  const unauthorized = await resolveInstallationRepository({
    fullName: "wazootech/private",
    token: "installation-token",
    fetchImpl: async () => new Response("{}", { status: 403 }),
  });
  assert.deepEqual(unauthorized, { ok: false, failure: "not-authorized" });

  const broken = await resolveInstallationRepository({
    fullName: "wazootech/private",
    token: "installation-token",
    fetchImpl: async () => {
      throw new Error("socket hang up");
    },
  });
  assert.deepEqual(broken, { ok: false, failure: "api-error" });

  const malformed = await resolveInstallationRepository({
    fullName: "wazootech/private",
    token: "installation-token",
    fetchImpl: async () => new Response(JSON.stringify({ id: "not-a-number" }), { status: 200 }),
  });
  assert.deepEqual(malformed, { ok: false, failure: "api-error" });
});

test("attaches the resolved repository so the shared GitHub readers find a target", async () => {
  const request = new Request("https://example.com/eve/v1/session", { method: "POST" });
  const resolve: SessionRepositoryResolver = async () => ({ ok: true, target });
  const outcome = await attachSessionRepository(userAuth(), request, { resolve, env: {} });

  assert.equal(outcome.attached, true);
  assert.deepEqual(repositoryTargetFromAuth(outcome.auth), target);
  assert.equal(sessionRepositoryFailure(outcome.auth), null);
  assert.equal(sessionRepositoryNotice(outcome.auth, {}), null);
});

test("records a legible failure instead of attaching an unreachable repository", async () => {
  const request = new Request("https://example.com/eve/v1/session", {
    headers: { [SESSION_REPOSITORY_HEADER]: "wazootech/secret" },
    method: "POST",
  });
  const outcome = await attachSessionRepository(userAuth(), request, {
    resolve: async () => ({ ok: false, failure: "not-covered" }),
    env: {},
  });

  assert.equal(outcome.attached, false);
  assert.equal(outcome.failure, "not-covered");
  assert.equal(repositoryTargetFromAuth(outcome.auth), null);
  assert.deepEqual(sessionRepositoryFailure(outcome.auth), { failure: "not-covered", fullName: "wazootech/secret" });
  const notice = sessionRepositoryNotice(outcome.auth, {});
  assert.ok(notice);
  assert.match(notice, /wazootech\/secret/);
  assert.match(notice, /installation does not cover/);
});

test("a malformed repository name is reported without calling GitHub", async () => {
  const request = new Request("https://example.com/eve/v1/session", {
    headers: { [SESSION_REPOSITORY_HEADER]: "wazootech/workspace/issues" },
    method: "POST",
  });
  let calls = 0;
  const outcome = await attachSessionRepository(userAuth(), request, {
    resolve: async () => {
      calls += 1;
      return { ok: true, target };
    },
    env: {},
  });

  assert.equal(calls, 0);
  assert.equal(outcome.attached, false);
  if (outcome.attached) return;
  assert.equal(outcome.failure, "invalid-format");
  assert.match(sessionRepositoryNotice(outcome.auth, {}) ?? "", /owner\/name/);
});

test("app and runtime principals keep the auth they already had", async () => {
  const request = new Request("https://example.com/eve/v1/session", { method: "POST" });
  let calls = 0;
  const appAuth = { attributes: {}, authenticator: "app", principalId: "eve:app", principalType: "runtime" };
  const outcome = await attachSessionRepository(appAuth, request, {
    resolve: async () => {
      calls += 1;
      return { ok: true, target };
    },
    env: {},
  });

  assert.equal(calls, 0);
  assert.equal(outcome.attached, false);
  assert.equal(outcome.auth, appAuth);
});

test("reports incomplete deployment credentials as a legible failure", async () => {
  const request = new Request("https://example.com/eve/v1/session", { method: "POST" });
  const resolve = createSessionRepositoryResolver({
    fetchImpl: async () => repositoryResponse(),
    mintToken: async () => {
      throw new Error("GitHub App credentials are incomplete");
    },
  });

  const outcome = await attachSessionRepository(userAuth(), request, { resolve, env: {} });
  assert.equal(outcome.attached, false);
  if (outcome.attached) return;
  assert.equal(outcome.failure, "credentials-incomplete");
  assert.match(sessionRepositoryNotice(outcome.auth, {}) ?? "", /GITHUB_APP_ID/);
});

test("memoizes successful resolutions and retries the rest", async () => {
  const nowMs = 1_000;
  let now = nowMs;
  let mints = 0;
  let lookups = 0;
  let reachable = true;
  const resolve = createSessionRepositoryResolver({
    fetchImpl: async () => {
      lookups += 1;
      return reachable ? repositoryResponse() : new Response("{}", { status: 404 });
    },
    mintToken: async () => {
      mints += 1;
      return "installation-token";
    },
    now: () => now,
    ttlMs: 600_000,
  });

  assert.deepEqual(await resolve(target.fullName), { ok: true, target });
  assert.deepEqual(await resolve(target.fullName), { ok: true, target });
  assert.equal(mints, 1);
  assert.equal(lookups, 1);

  now += 600_001;
  assert.deepEqual(await resolve(target.fullName), { ok: true, target });
  assert.equal(lookups, 2);

  reachable = false;
  const failed = await resolve("wazootech/secret");
  assert.deepEqual(failed, { ok: false, failure: "not-covered" });
  assert.deepEqual(await resolve("wazootech/secret"), { ok: false, failure: "not-covered" });
  assert.equal(lookups, 4);
});
