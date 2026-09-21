/**
 * The bound GitHub tool surface, read from the repository rather than declared
 * by hand.
 *
 * `agent/tools/github__*.ts` bind the `@github-tools/sdk` tool factories through
 * `defineDynamic`, so they do not appear in `.eve/agent-summary.json`: eve
 * resolves them per session, from the session's repository and token. A
 * projection built only from the compiled manifest would therefore omit the
 * entire GitHub surface — the largest part of what Computer actually does — and
 * would read as if the agent were mostly local file tools.
 *
 * So the surface is derived instead: the authored binding files say which tools
 * this repository exposes, and the installed SDK's type declarations carry each
 * tool's one-line description and the write/read split. Both are pinned by the
 * lockfile, and both fail loudly when a bound tool cannot be resolved, so the
 * projection can never quietly shrink.
 *
 * Names are bare SDK names (`getRepository`); the `github__` prefix is an eve
 * binding convention and is applied where the tool is named to the model.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";

export const GITHUB_TOOL_BINDING_PREFIX = "github__";

/** The SDK's blanket approval default; the repository's own policy replaces it. */
const APPROVAL_NOTE = " Requires approval by default.";

export type GithubToolSurfaceEntry = {
  /** Bare SDK tool name, e.g. `getRepository`. */
  name: string;
  description: string;
  /** Repository-relative path to the authored binding file. */
  sourcePath: string;
  /** True when the SDK classifies the tool as a write operation. */
  write: boolean;
  /** How the tool reaches the model: `github__<name>`. */
  boundName: string;
};

/**
 * Directory holding the installed SDK's type declarations, derived from its own
 * exports map. Descriptions are not all in one file: the eve entry declares the
 * mountable factories, and the shared chunk declares the rest, so every `.d.mts`
 * in the package is read.
 */
export function resolveGithubSdkDeclarationsDir(): string {
  const entry = import.meta.resolve("@github-tools/sdk/eve");
  const declarationsDir = posix.dirname(entry.replace(/^file:\/\//u, ""));
  if (!existsSync(declarationsDir)) {
    throw new Error(`no GitHub SDK declarations at ${declarationsDir}; the tool descriptions cannot be resolved`);
  }
  return declarationsDir;
}

/** Bare tool names bound by the authored `github__*.ts` files, sorted. */
export function readBoundGithubToolNames(toolsDir: string): string[] {
  if (!existsSync(toolsDir)) return [];
  return readdirSync(toolsDir)
    .filter((entry) => entry.startsWith(GITHUB_TOOL_BINDING_PREFIX) && entry.endsWith(".ts"))
    .map((entry) => entry.slice(GITHUB_TOOL_BINDING_PREFIX.length, -".ts".length))
    .filter((name) => name.length > 0)
    .sort((left, right) => left.localeCompare(right, "en-US"));
}

/**
 * One-line descriptions from the SDK's declarations: the first prose line of the
 * JSDoc block in front of `declare const <name>`. Deprecation tags and URLs are
 * skipped, because they describe the import path rather than the tool.
 *
 * The comment may not span a previous block. A pattern that only requires the
 * closing delimiter to sit before `declare const` will slurp the preceding
 * block, which is how `getRepository` first picked up `createGithubTools`'s
 * description. `APPROVAL_NOTE` is dropped because it describes the SDK's
 * default: this repository decides approvals per binding, so `metadata_.write`
 * carries that split instead.
 */
export function readGithubToolDescriptions(declarationsDir: string): Map<string, string> {
  const descriptions = new Map<string, string>();
  const pattern = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*declare const (\w+):/gu;
  const files = readdirSync(declarationsDir)
    .filter((entry) => entry.endsWith(".d.mts"))
    .sort((left, right) => left.localeCompare(right, "en-US"));
  for (const file of files) {
    const source = readFileSync(join(declarationsDir, file), "utf8");
    for (const match of source.matchAll(pattern)) {
      const [, comment, name] = match;
      if (descriptions.has(name)) continue;
      const line = comment
        .split("\n")
        .map((entry) => entry.replace(/^\s*\*?\s?/u, "").trim())
        .find((entry) => entry.length > 0 && !entry.startsWith("@") && !entry.startsWith("http"));
      if (line !== undefined) descriptions.set(name, line.replace(APPROVAL_NOTE, "").trim());
    }
  }
  return descriptions;
}

export type GithubToolCatalogOptions = {
  /** Absolute path to the agent's `tools/` directory. */
  toolsDir: string;
  /** Agent directory label used in `source_path`, e.g. `agent`. */
  agentDirLabel: string;
  declarationsDir: string;
  /** SDK write-tool names; `GITHUB_WRITE_TOOLS` is a record, so keys are the names. */
  writeToolNames: readonly string[];
  /** Restrict the surface to these bare names when given (Data's read-only set). */
  only?: readonly string[];
};

/**
 * Build the surface. A bound tool with no resolvable description is an error,
 * not an omission: silently dropping it would understate the agent's reach.
 */
export function githubToolSurface(options: GithubToolCatalogOptions): GithubToolSurfaceEntry[] {
  const bound = options.only ?? readBoundGithubToolNames(options.toolsDir);
  const descriptions = readGithubToolDescriptions(options.declarationsDir);
  const writes = new Set(options.writeToolNames);

  return [...bound]
    .sort((left, right) => left.localeCompare(right, "en-US"))
    .map((name) => {
      const description = descriptions.get(name);
      if (description === undefined) {
        throw new Error(
          `no description for GitHub tool ${name} in ${options.declarationsDir}; the surface cannot be projected faithfully`,
        );
      }
      return {
        name,
        boundName: `${GITHUB_TOOL_BINDING_PREFIX}${name}`,
        description,
        sourcePath: posix.join(options.agentDirLabel, "tools", `${GITHUB_TOOL_BINDING_PREFIX}${name}.ts`),
        write: writes.has(name),
      } satisfies GithubToolSurfaceEntry;
    });
}
