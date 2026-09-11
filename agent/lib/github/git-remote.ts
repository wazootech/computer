import type { SandboxNetworkPolicy } from "eve/sandbox";
import type { RepositoryTarget } from "./repository-target.js";
import { repositoryRemoteUrl } from "./repository-target.js";

const PROTECTED_BRANCHES = new Set(["main", "master"]);
const BRANCH_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/;

export const REPO_DIR = "/workspace/repo";

export function remoteUrl(target: RepositoryTarget): string {
  return repositoryRemoteUrl(target);
}

export function validateBranch(branch: string): string | null {
  if (!BRANCH_PATTERN.test(branch) || branch.includes("..") || branch.includes("//")) {
    return `"${branch}" is not a valid branch name.`;
  }
  if (branch.startsWith("refs/") || branch === "HEAD") {
    return `"${branch}" is not a plain branch name.`;
  }
  if (PROTECTED_BRANCHES.has(branch)) {
    return `Direct pushes to ${branch} are not allowed.`;
  }
  return null;
}

export function brokerPolicy(installationToken: string): SandboxNetworkPolicy {
  const authorization = `Basic ${Buffer.from(`x-access-token:${installationToken}`).toString("base64")}`;
  return {
    allow: {
      "*": [],
      "github.com": [{ transform: [{ headers: { Authorization: authorization } }] }],
    },
  };
}
