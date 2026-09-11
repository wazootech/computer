import { createHash } from "node:crypto";
import { FACTORY_BRAIN_PREFIX } from "./blob.js";
import type { RepositoryTarget } from "./github/repository-target.js";
import { repositoryScopeKey } from "./github/repository-target.js";

export const MAX_FACTORY_BRAIN_LENGTH = 40_000;

export const factoryBrainKey = (target: RepositoryTarget): string =>
  `${FACTORY_BRAIN_PREFIX}${repositoryScopeKey(target)}-${createHash("sha256").update(target.fullName).digest("hex").slice(0, 16)}.md`;
