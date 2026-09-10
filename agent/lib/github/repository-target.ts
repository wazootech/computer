import { createHash } from "node:crypto";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import type { GitHubInboundContext } from "eve/channels/github";

const FULL_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

type AuthLike = SessionAuthContext | SessionAuth | null | undefined;

export type RepositoryTarget = Readonly<{
  fullName: string;
  id: number;
  name: string;
  owner: string;
}>;

export function repositoryTargetFromInbound(ctx: GitHubInboundContext): RepositoryTarget {
  return {
    fullName: ctx.repository.fullName,
    id: ctx.repository.id,
    name: ctx.repository.name,
    owner: ctx.repository.owner,
  };
}

export function repositoryAttributes(target: RepositoryTarget): Record<string, string> {
  return {
    githubRepositoryFullName: target.fullName,
    githubRepositoryId: String(target.id),
    githubRepositoryName: target.name,
    githubRepositoryOwner: target.owner,
  };
}

export function stampRepositoryTarget(
  auth: SessionAuthContext,
  target: RepositoryTarget
): SessionAuthContext {
  return { ...auth, attributes: { ...auth.attributes, ...repositoryAttributes(target) } };
}

export function repositoryTargetFromAuth(auth: AuthLike): RepositoryTarget | null {
  const context = auth && "current" in auth ? auth.current ?? auth.initiator : auth;
  const attributes = context?.attributes;
  const owner = attributes?.githubRepositoryOwner;
  const name = attributes?.githubRepositoryName;
  const fullName = attributes?.githubRepositoryFullName;
  const id = Number(attributes?.githubRepositoryId);
  if (
    typeof owner !== "string" ||
    typeof name !== "string" ||
    typeof fullName !== "string" ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    fullName !== `${owner}/${name}` ||
    !FULL_NAME_PATTERN.test(fullName)
  ) {
    return null;
  }
  return { fullName, id, name, owner };
}

export function repositoryScopeKey(target: RepositoryTarget): string {
  return createHash("sha256").update(`${target.id}:${target.fullName}`).digest("hex").slice(0, 32);
}

export function repositoryRemoteUrl(target: RepositoryTarget): string {
  return `https://github.com/${target.fullName}.git`;
}
