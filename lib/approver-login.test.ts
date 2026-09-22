import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVER_ROSTER_UNAVAILABLE_REASON,
  MISSING_APPROVER_LOGIN_REASON,
  approverTeamRoster,
  clearApproverTeamRosterCache,
  evaluateApproverAccess,
  linkedGithubAccountId,
  resolveApproverLogin,
  sessionGithubLogin,
  stampGithubLogin,
} from "../agent/lib/github/approver-login.ts";

const ETHAN_LOGIN = "EthanThatOneKid";
const ETHAN_GITHUB_ID = "31261035";

function rosterResponse(
  members: Array<{ login: string; id: number }>,
  next: string | null = null,
): Response {
  return new Response(JSON.stringify(members), {
    status: 200,
    headers: next === null ? {} : { link: `<${next}>; rel="next"` },
  });
}

test("picks the linked GitHub account id out of better-auth's account list", () => {
  assert.equal(
    linkedGithubAccountId([
      { providerId: "vercel", accountId: "team_x" },
      { providerId: "github", accountId: ETHAN_GITHUB_ID },
    ]),
    ETHAN_GITHUB_ID,
  );
  assert.equal(linkedGithubAccountId([{ providerId: "vercel", accountId: "team_x" }]), null);
  assert.equal(linkedGithubAccountId([]), null);
  assert.equal(linkedGithubAccountId(null), null);
});

test("resolves the verified login of an approver-team member by GitHub id", async () => {
  clearApproverTeamRosterCache();
  let calls = 0;
  const login = await resolveApproverLogin({
    accountId: ETHAN_GITHUB_ID,
    env: {},
    fetchImpl: async () => {
      calls += 1;
      return rosterResponse([{ login: ETHAN_LOGIN, id: Number(ETHAN_GITHUB_ID) }]);
    },
    mintToken: async () => "installation-token",
  });

  assert.equal(login, ETHAN_LOGIN);
  assert.equal(calls, 1);
});

test("refuses to attribute an approval to a login that is not on the approver team", async () => {
  clearApproverTeamRosterCache();
  const login = await resolveApproverLogin({
    accountId: "999",
    env: {},
    fetchImpl: async () => rosterResponse([{ login: ETHAN_LOGIN, id: Number(ETHAN_GITHUB_ID) }]),
    mintToken: async () => "installation-token",
  });

  assert.equal(login, null);
});

test("fails closed when the roster cannot be read", async () => {
  clearApproverTeamRosterCache();
  const login = await resolveApproverLogin({
    accountId: ETHAN_GITHUB_ID,
    env: {},
    fetchImpl: async () => {
      throw new Error("network down");
    },
    mintToken: async () => "installation-token",
  });

  assert.equal(login, null);

  clearApproverTeamRosterCache();
  const noCredentials = await resolveApproverLogin({
    accountId: ETHAN_GITHUB_ID,
    env: {},
    fetchImpl: async () => rosterResponse([]),
    mintToken: async () => {
      throw new Error("GitHub App credentials are incomplete");
    },
  });

  assert.equal(noCredentials, null);
});

test("reads the roster once per TTL and paginates it", async () => {
  clearApproverTeamRosterCache();
  let now = 0;
  const urls: string[] = [];
  const fetchImpl = async (input: URL | RequestInfo) => {
    urls.push(String(input));
    if (urls.length === 1) {
      return rosterResponse([{ login: "someone", id: 1 }], "https://api.github.com/orgs/wazootech/teams/team/members?page=2");
    }
    return rosterResponse([{ login: ETHAN_LOGIN, id: Number(ETHAN_GITHUB_ID) }]);
  };

  const first = await approverTeamRoster({ env: {}, fetchImpl, mintToken: async () => "token", now: () => now });
  assert.equal(first.logins.size, 2);
  assert.equal(first.loginsById.get(ETHAN_GITHUB_ID), ETHAN_LOGIN);
  assert.equal(urls.length, 2);

  now += 60_000;
  await approverTeamRoster({ env: {}, fetchImpl, mintToken: async () => "token", now: () => now });
  assert.equal(urls.length, 2, "roster read is cached inside the TTL");

  now += 300_000;
  await approverTeamRoster({ env: {}, fetchImpl, mintToken: async () => "token", now: () => now });
  assert.equal(urls.length, 3, "roster is read again after the TTL");
});

test("stamps and reads the verified login on session auth", () => {
  const auth = { attributes: { name: "Ethan" }, authenticator: "better-auth:vercel", principalId: "u1", principalType: "user" };
  const stamped = stampGithubLogin(auth as never, ETHAN_LOGIN);

  assert.equal(sessionGithubLogin(stamped), ETHAN_LOGIN);
  assert.equal(sessionGithubLogin(auth as never), null);
  assert.equal(sessionGithubLogin(null), null);
});

test("approval decisions name the missing piece", () => {
  const roster = { logins: new Set([ETHAN_LOGIN.toLowerCase()]), loginsById: new Map() };

  assert.deepEqual(evaluateApproverAccess({ login: ETHAN_LOGIN, roster }), { status: "allowed" });
  assert.deepEqual(evaluateApproverAccess({ login: null, roster }), {
    status: "rejected",
    reason: MISSING_APPROVER_LOGIN_REASON,
  });

  const outsider = evaluateApproverAccess({ login: "outsider", roster });
  assert.equal(outsider.status, "rejected");
  assert.match("reason" in outsider ? outsider.reason : "", /outsider is not a member/);
});

test("a chat approval with no verified login is rejected with the reason that says so", () => {
  const responder = { attributes: {}, authenticator: "better-auth:vercel", principalId: "u1", principalType: "user" };
  const login = sessionGithubLogin(responder as never);

  assert.equal(login, null);
  assert.deepEqual(evaluateApproverAccess({ login, roster: { logins: new Set(), loginsById: new Map() } }), {
    status: "rejected",
    reason: MISSING_APPROVER_LOGIN_REASON,
  });
  assert.match(APPROVER_ROSTER_UNAVAILABLE_REASON, /approver team could not be verified/);
});
