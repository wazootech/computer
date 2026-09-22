import type { ApprovalResponseContext } from "eve/tools/approval";

import { mintInstallationToken } from "./app-token.js";

import {
  APPROVER_ROSTER_UNAVAILABLE_REASON,
  MISSING_APPROVER_LOGIN_REASON,
  approverTeamRoster,
  evaluateApproverAccess,
  sessionGithubLogin,
} from "./approver-login.js";

/**
 * Resolves an approval response against the approver team.
 *
 * Every rejection names the missing piece, because the two failure modes need
 * different fixes: no verified identity at all (link a GitHub account, or
 * respond from GitHub) versus a verified identity that is not on the team.
 */
export async function teamApprovalResponse({
  responder,
}: ApprovalResponseContext): Promise<{ status: "allowed" } | { status: "rejected"; reason: string }> {
  const login = sessionGithubLogin(responder);
  if (login === null) return { status: "rejected", reason: MISSING_APPROVER_LOGIN_REASON };
  try {
    return evaluateApproverAccess({ login, roster: await approverTeamRoster({ mintToken: mintInstallationToken }) });
  } catch {
    return { status: "rejected", reason: APPROVER_ROSTER_UNAVAILABLE_REASON };
  }
}
