import { type AuthFn, localDev, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import type { SessionAuthContext } from "eve/context";
import { auth } from "@/lib/auth";
import { mintInstallationToken } from "#lib/github/app-token.js";
import {
  linkedGithubAccountId,
  resolveApproverLogin,
  stampGithubLogin,
} from "#lib/github/approver-login.js";
import {
  attachSessionRepository,
  createSessionRepositoryResolver,
  sessionRepositoryNotice,
} from "#lib/github/session-attachment.js";

const localDevAuth = localDev();

const betterAuthSession: AuthFn<Request> = async (request) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;

  const attributes: Record<string, string> = {
    email: session.user.email,
    name: session.user.name,
  };
  if (session.user.image) {
    attributes.picture = session.user.image;
  }

  return {
    attributes,
    authenticator: "better-auth:vercel",
    principalId: session.user.id,
    principalType: "user",
  };
};

const localDevUser: AuthFn<Request> = async (request) => {
  const local = await localDevAuth(request);
  return local ? { ...local, principalType: "user" } : null;
};

/**
 * Attaches a verified GitHub repository to the authenticated principal.
 *
 * Every HTTP-channel session a human starts gets a repository it can read and
 * write through the GitHub tools, so a session no longer dead-ends on "No
 * verified GitHub repository is attached to this session". The attachment is
 * resolved against the Computer App installation, which covers every repository
 * in the org, and it defaults to the federation manifest repo
 * (`COMPUTER_SESSION_REPOSITORY`, else `wazootech/workspace`). A request can
 * point the session at another repository with the `x-computer-repository`
 * header; a repository the installation cannot reach fails closed and is
 * reported instead of binding tools that would 404 later.
 *
 * Only human principals are attached: app and runtime principals (eval and
 * schedule runs) keep the auth they have today.
 */
const resolveSessionRepository = createSessionRepositoryResolver({
  fetchImpl: fetch,
  mintToken: mintInstallationToken,
});

function withRepository(authFn: AuthFn<Request>): AuthFn<Request> {
  return async (request) =>
    (await attachSessionRepository((await authFn(request)) ?? null, request, { resolve: resolveSessionRepository })).auth;
}

/**
 * Attributes the session's write approvals to a verified GitHub login.
 *
 * The GitHub channel stamps the event sender's login, so its approvals resolve.
 * A chat session has no sender: the person's linked GitHub account is the only
 * verified login, so it is resolved against the approver-team roster and stamped
 * as `githubLogin`, which is the attribute the approval responder check reads. A
 * login that is not on the team is not stamped at all, so the approval is
 * rejected with a legible reason rather than attributed to the wrong person.
 */
async function linkedApproverLogin(request: Request): Promise<string | null> {
  let accounts: unknown;
  try {
    accounts = await auth.api.listUserAccounts({ headers: request.headers });
  } catch {
    return null;
  }
  return resolveApproverLogin({
    accountId: linkedGithubAccountId(accounts),
    mintToken: mintInstallationToken,
  });
}

function withApproverLogin(authFn: AuthFn<Request>): AuthFn<Request> {
  return async (request) => {
    const authorization = (await authFn(request)) ?? null;
    if (authorization === null || authorization.principalType !== "user") return authorization;
    const login = await linkedApproverLogin(request);
    return login === null ? authorization : stampGithubLogin(authorization, login);
  };
}

/**
 * The nesting order is the substance of the composition: `withApproverLogin`
 * must stay outside `withRepository`, so the stamped login is applied after the
 * repository attachment rather than being replaced by it. Inverting the two
 * wrappers silently drops `githubLogin` and every chat approval fails again, so
 * `lib/channel-composition.test.ts` asserts the order.
 */
export default eveChannel({
  auth: [
    withApproverLogin(withRepository(betterAuthSession)),
    withRepository(vercelOidc()),
    withRepository(localDevUser),
  ],
  async onMessage(ctx) {
    const caller: SessionAuthContext | null = ctx.eve.caller;
    const notice = sessionRepositoryNotice(caller);
    return notice === null ? { auth: caller } : { auth: caller, context: [notice] };
  },
});
