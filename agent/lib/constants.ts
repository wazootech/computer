import { connect } from "@vercel/connect/eve";

export function requireEnv(name: string, example: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set (e.g. '${example}').`);
  }
  return value;
}

export const FACTORY_REPO = process.env.FACTORY_REPO ?? "wazootech/computer";
const FACTORY_REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

if (!FACTORY_REPO_PATTERN.test(FACTORY_REPO)) {
  throw new Error(`FACTORY_REPO must use owner/repo format, got '${FACTORY_REPO}'.`);
}

const [factoryOwner = "", factoryRepoName = ""] = FACTORY_REPO.split("/");
export const factoryRepo = { owner: factoryOwner, repo: factoryRepoName };
export const FACTORY_LABEL = process.env.FACTORY_LABEL ?? "factory";
export const FACTORY_BRANCH_PREFIX = process.env.FACTORY_BRANCH_PREFIX ?? "factory/";

export const linearAuth = connect({
  connector: process.env.LINEAR_CONNECTOR ?? "linear/computer",
  principalType: "app",
  tokenParams: {
    scopes: ["read", "write", "issues:create", "comments:create"],
  },
});
