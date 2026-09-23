/**
 * The GitHub surface is derived, not declared: the authored `github__*.ts`
 * bindings say what this repository exposes, and the installed SDK's type
 * declarations say what each tool is called and whether it writes. These tests
 * pin both halves of that claim, because a silent shrink in either direction
 * would understate what Computer can reach.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GITHUB_WRITE_TOOLS } from "@github-tools/sdk/eve-runtime";
import {
  GITHUB_TOOL_BINDING_PREFIX,
  githubToolSurface,
  readBoundGithubToolNames,
  readGithubToolDescriptions,
  resolveGithubSdkDeclarationsDir,
} from "./github-tool-catalog.ts";

const TOOLS_DIR = join(process.cwd(), "agent", "tools");
const WRITE_TOOL_NAMES = Object.keys(GITHUB_WRITE_TOOLS);

function withDeclarations(files: Record<string, string>, run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "github-catalog-"));
  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content, "utf8");
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("every bound github tool resolves to a description", () => {
  const bound = readBoundGithubToolNames(TOOLS_DIR);
  assert.ok(bound.length > 20, `expected the authored bindings to cover the GitHub surface, found ${bound.length}`);

  const surface = githubToolSurface({
    toolsDir: TOOLS_DIR,
    agentDirLabel: "agent",
    declarationsDir: resolveGithubSdkDeclarationsDir(),
    writeToolNames: WRITE_TOOL_NAMES,
  });

  assert.equal(surface.length, bound.length);
  for (const entry of surface) {
    assert.ok(entry.description.length > 0, `${entry.name} has no description`);
    assert.equal(entry.boundName, `${GITHUB_TOOL_BINDING_PREFIX}${entry.name}`);
    assert.equal(entry.sourcePath, `agent/tools/${GITHUB_TOOL_BINDING_PREFIX}${entry.name}.ts`);
  }
});

test("a description never spans the comment block before it", () => {
  withDeclarations(
    {
      "chunk.d.mts": [
        "/**",
        " * Register all GitHub tools (or a preset subset) as eve dynamic capabilities.",
        " */",
        "declare function createGithubTools(options?: unknown): unknown;",
        "/**",
        " * Get information about a GitHub repository including description and stars.",
        " */",
        "declare const getRepository: (options?: unknown) => unknown;",
        "",
      ].join("\n"),
    },
    (dir) => {
      const descriptions = readGithubToolDescriptions(dir);
      assert.equal(
        descriptions.get("getRepository"),
        "Get information about a GitHub repository including description and stars.",
      );
      // Mount helpers are `declare function`, not tool factories: they are not part
      // of the bound surface, and must not be read as if they were.
      assert.equal(descriptions.has("createGithubTools"), false);
    },
  );
});

test("the SDK's approval sentence is dropped, not exported as a tool description", () => {
  withDeclarations(
    {
      "chunk.d.mts": [
        "/**",
        " * Create a new issue in a GitHub repository.",
        " * Requires approval by default.",
        " *",
        " * @deprecated Cherry-picking tool factories is deprecated.",
        " */",
        "declare const createIssue: (options?: unknown) => unknown;",
        "",
      ].join("\n"),
    },
    (dir) => {
      const descriptions = readGithubToolDescriptions(dir);
      assert.equal(descriptions.get("createIssue"), "Create a new issue in a GitHub repository.");
    },
  );
});

test("a bound tool with no resolvable description fails loudly", () => {
  const toolsDir = mkdtempSync(join(tmpdir(), "github-bindings-"));
  try {
    writeFileSync(join(toolsDir, "github__resolveGithubToken.ts"), "export default null;\n", "utf8");
    withDeclarations({ "chunk.d.mts": "declare const other: unknown;\n" }, (dir) => {
      assert.throws(
        () =>
          githubToolSurface({
            toolsDir,
            agentDirLabel: "agent",
            declarationsDir: dir,
            writeToolNames: [],
          }),
        /no description for GitHub tool resolveGithubToken/u,
      );
    });
  } finally {
    rmSync(toolsDir, { recursive: true, force: true });
  }
});

test("a restricted surface carries only the declared tools, and none of them write", () => {
  const readOnly = ["getRepository", "getFileContent", "listIssues", "searchCode"];
  const surface = githubToolSurface({
    toolsDir: TOOLS_DIR,
    agentDirLabel: "agent",
    declarationsDir: resolveGithubSdkDeclarationsDir(),
    writeToolNames: WRITE_TOOL_NAMES,
    only: readOnly,
  });

  assert.deepEqual(
    surface.map((entry) => entry.name),
    [...readOnly].sort((left, right) => left.localeCompare(right, "en-US")),
  );
  for (const entry of surface) assert.equal(entry.write, false, `${entry.name} is a write tool`);
});

test("the projected write flag is exactly the set this repository gates behind approval", () => {
  const policy = readFileSync(join(process.cwd(), "agent", "lib", "github", "tool-options.ts"), "utf8");
  const gated = new Set([...policy.matchAll(/case "(\w+)":/gu)].map((match) => match[1]));
  assert.ok(gated.size > 0, "the approval switch should name the tools it gates");

  const surface = githubToolSurface({
    toolsDir: TOOLS_DIR,
    agentDirLabel: "agent",
    declarationsDir: resolveGithubSdkDeclarationsDir(),
    writeToolNames: WRITE_TOOL_NAMES,
  });

  for (const entry of surface) {
    assert.equal(
      entry.write,
      gated.has(entry.name),
      `${entry.name} is projected as write=${entry.write}; the repository gates ${gated.has(entry.name)}`,
    );
  }
  for (const name of gated) {
    assert.ok(
      WRITE_TOOL_NAMES.includes(name),
      `${name} is approval-gated in this repository but the SDK does not classify it as a write`,
    );
  }
});
