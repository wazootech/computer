import type { SessionAuthContext } from "eve/context";

/**
 * Verified GitHub identity for approval attribution.
 *
 * A write from a chat session is approval-gated, and the approval responder is
 * checked against the approver-team roster. The GitHub channel stamps
 * `githubLogin` from the event sender, which a chat session never has, so an
 * approval from chat used to fail every time with the same generic message.
 *
 * Here the linked GitHub account supplies the identity instead: the session's
 * better-auth account row carries the GitHub user id, and membership is proven
 * by that id appearing in the approver-team roster. Ids are matched rather than
 * logins so nothing depends on a login the user typed, and the roster read is
 * the same cached call the approval response itself uses.
 */

export const GITHUB_LOGIN_ATTRIBUTE = "githubLogin";

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const ROSTER_TTL_MS = 300_000;

type Environment = Record<string, string | undefined>;

export type ApproverTeamRoster = {
  /** Lowercased logins of every approver-team member. */
  logins: Set<string>;
  /** GitHub user id to login, for identity resolved from a linked account. */
  loginsById: Map<string, string>;
};

let rosterCache: { key: string; expiresAt: number; roster: ApproverTeamRoster } | null = null;
let inFlight: { key: string; promise: Promise<ApproverTeamRoster> } | null = null;

export function approverTeamConfig(env: Environment = process.env): { org: string; team: string } {
  return {
    org: env.COMPUTER_APPROVER_ORG ?? "wazootech",
    team: env.COMPUTER_APPROVER_TEAM ?? "team",
  };
}

function nextLink(response: Response): string | null {
  const link = response.headers.get("link");
  const match = link?.match(/<([^>]+)>;\s*rel="next"/u);
  return match?.[1] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reads the approver-team roster once per TTL, sharing it with approval checks. */
export async function approverTeamRoster(input: {
  mintToken: () => Promise<string>;
  env?: Environment;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<ApproverTeamRoster> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? Date.now;
  const { org, team } = approverTeamConfig(env);
  const key = `${org}/${team}`;

  if (rosterCache !== null && rosterCache.key === key && rosterCache.expiresAt > now()) {
    return rosterCache.roster;
  }
  if (inFlight !== null && inFlight.key === key) return inFlight.promise;

  const pending = (async () => {
    const token = await input.mintToken();
    const logins = new Set<string>();
    const loginsById = new Map<string, string>();
    let url: string | null =
      `${API}/orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(team)}/members?per_page=100`;
    while (url !== null) {
      const response: Response = await fetchImpl(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": API_VERSION,
        },
      });
      if (!response.ok) throw new Error(`approver team lookup returned HTTP ${response.status}`);
      const members = (await response.json()) as unknown;
      if (!Array.isArray(members)) throw new Error("approver team response was not a list");
      for (const member of members) {
        if (!isRecord(member)) continue;
        const login = typeof member.login === "string" ? member.login : null;
        if (login === null) continue;
        logins.add(login.toLowerCase());
        if (typeof member.id === "number") loginsById.set(String(member.id), login);
      }
      url = nextLink(response);
    }
    const roster = { logins, loginsById };
    rosterCache = { key, expiresAt: now() + ROSTER_TTL_MS, roster };
    return roster;
  })();

  inFlight = { key, promise: pending };
  try {
    return await pending;
  } finally {
    if (inFlight?.promise === pending) inFlight = null;
  }
}

/** Test seam: drop the cached roster. */
export function clearApproverTeamRosterCache(): void {
  rosterCache = null;
  inFlight = null;
}

/**
 * Picks the linked GitHub account id out of better-auth's account list.
 *
 * Returns null when the principal has no GitHub account linked, which is the
 * ordinary state of a Vercel-only sign-in.
 */
export function linkedGithubAccountId(accounts: unknown): string | null {
  if (!Array.isArray(accounts)) return null;
  for (const account of accounts) {
    if (!isRecord(account)) continue;
    if (account.providerId !== "github") continue;
    const accountId = account.accountId;
    if (typeof accountId === "string" && accountId.length > 0) return accountId;
  }
  return null;
}

/**
 * The verified GitHub login for a linked account, or null when the account is
 * not on the approver team.
 *
 * A null result is deliberately indistinguishable from "no linked account" at
 * the call site: neither may be stamped as an identity.
 */
export async function resolveApproverLogin(input: {
  accountId: string | null;
  mintToken: () => Promise<string>;
  env?: Environment;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<string | null> {
  if (input.accountId === null) return null;
  try {
    const roster = await approverTeamRoster(input);
    return roster.loginsById.get(input.accountId) ?? null;
  } catch {
    return null;
  }
}

/** Rejection text for a session with no verified identity to attribute a write to. */
export const MISSING_APPROVER_LOGIN_REASON =
  "This session has no verified GitHub login to attribute the approval to. Sign in with GitHub, or respond from a GitHub issue or pull request.";

/** Rejection text for a roster read that could not be trusted. */
export const APPROVER_ROSTER_UNAVAILABLE_REASON =
  "The Computer approver team could not be verified.";

export type ApprovalDecision = { status: "allowed" } | { status: "rejected"; reason: string };

/**
 * Decides one approval from a verified login and the approver roster.
 *
 * Pure so the two rejection modes stay distinguishable and testable: a missing
 * identity names the missing identity, and a non-member names the login.
 */
export function evaluateApproverAccess(input: {
  login: string | null;
  roster: ApproverTeamRoster;
}): ApprovalDecision {
  if (input.login === null) return { status: "rejected", reason: MISSING_APPROVER_LOGIN_REASON };
  return input.roster.logins.has(input.login.toLowerCase())
    ? { status: "allowed" }
    : {
        status: "rejected",
        reason: `GitHub user ${input.login} is not a member of the Computer approver team.`,
      };
}

export function stampGithubLogin(auth: SessionAuthContext, login: string): SessionAuthContext {
  return { ...auth, attributes: { ...auth.attributes, [GITHUB_LOGIN_ATTRIBUTE]: login } };
}

/** The stamped verified login, for approval attribution. */
export function sessionGithubLogin(auth: SessionAuthContext | null): string | null {
  const stamped = auth?.attributes[GITHUB_LOGIN_ATTRIBUTE];
  return typeof stamped === "string" && stamped.length > 0 ? stamped : null;
}
