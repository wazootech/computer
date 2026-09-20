import { type AuthFn, localDev, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import type { SessionAuthContext } from "eve/context";
import { auth } from "@/lib/auth";
import { mintInstallationToken } from "#lib/github/app-token.js";
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

export default eveChannel({
  auth: [withRepository(betterAuthSession), withRepository(vercelOidc()), withRepository(localDevUser)],
  async onMessage(ctx) {
    const caller: SessionAuthContext | null = ctx.eve.caller;
    const notice = sessionRepositoryNotice(caller);
    return notice === null ? { auth: caller } : { auth: caller, context: [notice] };
  },
});
