import type { ApprovalResponseContext } from "eve/tools/approval";
import { mintInstallationToken } from "./app-token.js";

const API = "https://api.github.com";
const cache = new Map<string, { expiresAt: number; logins: Set<string> }>();

function githubLogin(responder: ApprovalResponseContext["responder"]): string | null {
  const stamped = responder.attributes.githubLogin;
  if (typeof stamped === "string" && stamped.length > 0) return stamped;
  return null;
}

async function teamLogins(org: string, team: string): Promise<Set<string>> {
  const key = `${org}/${team}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.logins;

  const token = await mintInstallationToken();
  const response = await fetch(`${API}/orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(team)}/members?per_page=100`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`approver team lookup returned HTTP ${response.status}`);
  const members = (await response.json()) as Array<{ login?: unknown }>;
  const logins = new Set(members.flatMap((member) => typeof member.login === "string" ? [member.login.toLowerCase()] : []));
  cache.set(key, { expiresAt: Date.now() + 300_000, logins });
  return logins;
}

export async function teamApprovalResponse({ responder }: ApprovalResponseContext): Promise<{ status: "allowed" } | { status: "rejected"; reason: string }> {
  const login = githubLogin(responder);
  if (!login) return { status: "rejected", reason: "Only a verified member of the Computer approver team may approve this action." };
  try {
    const members = await teamLogins(process.env.COMPUTER_APPROVER_ORG ?? "wazootech", process.env.COMPUTER_APPROVER_TEAM ?? "team");
    return members.has(login.toLowerCase())
      ? { status: "allowed" }
      : { status: "rejected", reason: "This GitHub user is not a member of the Computer approver team." };
  } catch {
    return { status: "rejected", reason: "The Computer approver team could not be verified." };
  }
}
