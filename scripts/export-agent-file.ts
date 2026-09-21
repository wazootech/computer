import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, posix, resolve } from "node:path";

import { checkAgentFilePrivacy, checkProjectionIntegrity } from "../lib/agent-file-privacy.ts";
import {
  parseAgentFileDeclaration,
  projectAgentFile,
  serializeAgentFile,
  type AgentFileSource,
  type AgentFileToolInput,
} from "../lib/agent-file-project.ts";
import { validateAgentFile } from "../lib/agent-file-schema.ts";
import { githubToolSurface, resolveGithubSdkDeclarationsDir } from "../lib/github-tool-catalog.ts";
import { GITHUB_WRITE_TOOLS } from "@github-tools/sdk/eve-runtime";

/**
 * Export the Agent File (`.af`) projection of an agent.
 *
 * Two input modes, one projection:
 *
 *   --manifest <path>   A compiled eve manifest (`.eve/agent-summary.json`).
 *                       Authoritative for the prompt and the bound tool
 *                       surface, and the model handle is cross-checked against
 *                       the declaration. This is how Computer exports.
 *   --tool-bindings <d> The repository-relative directory holding the authored
 *                       `github__*.ts` bindings (default `agent`). Both the
 *                       glob and the exported source paths use it.
 *   --source <dir>      An agent directory with no eve build: `instructions.md`
 *                       plus the declaration (which then must list the tool
 *                       surface). This is how an agent that has not been
 *                       compiled yet — Data — exports, so its `.af` is still
 *                       generated from source rather than hand-written.
 *
 * Nothing here reads generated output back into `agent/`: the direction is
 * source -> `.af`, always.
 */

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(raw: string, path: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readJsonFile(path: string): Promise<unknown> {
  return readJson(await readFile(path, "utf8"), path);
}

/**
 * Every `skills/<name>/SKILL.md` under the agent directory, sorted by name.
 * `sourcePath` is repository-relative with forward slashes, because it becomes
 * the `source_url` a reader of the file will follow.
 */
async function readSkills(agentDir: string, agentDirLabel: string) {
  const skillsDir = join(agentDir, "skills");
  if (!existsSync(skillsDir)) return [];
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en-US"));

  const skills = [];
  for (const name of names) {
    const path = join(skillsDir, name, "SKILL.md");
    if (!existsSync(path)) continue;
    skills.push({
      name,
      sourcePath: posix.join(agentDirLabel, "skills", name, "SKILL.md"),
      content: await readFile(path, "utf8"),
    });
  }
  return skills;
}

/**
 * The GitHub tool names an agent declares when it has no eve build to read them
 * from. Names only: descriptions and the read/write split are resolved from the
 * SDK, so a declaration cannot drift from the installed tool surface.
 */
function declaredGithubToolNames(declarationRaw: Record<string, unknown>, path: string): string[] | null {
  const tools = declarationRaw.tools;
  if (tools === undefined) return null;
  if (!Array.isArray(tools)) throw new Error(`${path}.tools must be an array when present`);
  return tools.map((entry, index) => {
    const at = `${path}.tools[${index}]`;
    const name = typeof entry === "string" ? entry : isRecord(entry) ? entry.name : undefined;
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`${at} must be a GitHub tool name, or an object with a name`);
    }
    return name;
  });
}

/**
 * The GitHub surface as `.af` tools. `only` restricts it to a declared subset
 * (the read-only set an agent with no eve build is allowed to call); `null`
 * means the whole surface the repository actually binds.
 */
async function readGithubSurface(
  options: { toolBindingsDir: string },
  only: readonly string[] | null,
): Promise<AgentFileToolInput[]> {
  const surface = githubToolSurface({
    toolsDir: resolve(options.toolBindingsDir, "tools"),
    agentDirLabel: options.toolBindingsDir,
    declarationsDir: resolveGithubSdkDeclarationsDir(),
    writeToolNames: Object.keys(GITHUB_WRITE_TOOLS),
    ...(only === null ? {} : { only }),
  });
  return surface.map((entry) => ({
    name: entry.boundName,
    description: entry.description,
    sourcePath: entry.sourcePath,
    write: entry.write,
  }));
}

function instructionsFromManifest(manifest: Record<string, unknown>, manifestPath: string): string {
  const instructions = manifest.instructions;
  if (!Array.isArray(instructions) || instructions.length === 0) {
    throw new Error(`${manifestPath}.instructions must be a non-empty array`);
  }
  const parts = instructions.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.content !== "string") {
      throw new Error(`${manifestPath}.instructions[${index}].content must be a string`);
    }
    return entry.content;
  });
  return parts.join("\n\n");
}

async function buildSource(options: {
  repositoryUrl: string;
  manifestPath: string | null;
  sourceDir: string | null;
  agentDir: string;
  agentDirLabel: string;
  declarationPath: string;
  /**
   * Repository-relative directory holding the authored `github__*.ts` bindings.
   * It is also the prefix used in each tool's `source_path`, so a projection of
   * an agent whose own directory is elsewhere still points at files that exist.
   */
  toolBindingsDir: string;
  /** Bare GitHub tool names this agent may call; null means the whole bound surface. */
  githubTools: readonly string[] | null;
}): Promise<AgentFileSource> {
  const declarationRaw = await readJsonFile(options.declarationPath);
  if (!isRecord(declarationRaw)) throw new Error(`${options.declarationPath} must be a JSON object`);
  const declaration = parseAgentFileDeclaration(declarationRaw);
  const skills = await readSkills(options.agentDir, options.agentDirLabel);

  if (options.manifestPath !== null) {
    const manifest = await readJsonFile(options.manifestPath);
    if (!isRecord(manifest)) throw new Error(`${options.manifestPath} must be a JSON object`);
    const agent = manifest.agent;
    if (!isRecord(agent) || typeof agent.modelId !== "string") {
      throw new Error(`${options.manifestPath}.agent.modelId must be a string`);
    }
    if (agent.modelId !== declaration.model.handle) {
      throw new Error(
        `model drift: the compiled agent runs ${agent.modelId} but agent/agent-file-declaration.json declares ${declaration.model.handle}`,
      );
    }
    const toolsRaw = manifest.tools;
    if (!Array.isArray(toolsRaw)) throw new Error(`${options.manifestPath}.tools must be an array`);
    const tools: AgentFileToolInput[] = toolsRaw.map((entry, index) => {
      if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.description !== "string") {
        throw new Error(`${options.manifestPath}.tools[${index}] must carry a name and description`);
      }
      const logicalPath = typeof entry.logicalPath === "string" ? entry.logicalPath : null;
      return {
        name: entry.name,
        description: entry.description,
        sourcePath: logicalPath === null ? null : posix.join(options.agentDirLabel, logicalPath),
      };
    });

    // The manifest lists only statically bound tools. The GitHub surface is
    // bound per session, so it is recovered from the authored binding files and
    // is part of the declared surface, never an afterthought.
    const bound = await readGithubSurface(options, options.githubTools);
    return {
      declaration,
      instructions: instructionsFromManifest(manifest, options.manifestPath),
      tools: [...tools, ...bound],
      skills,
      repositoryUrl: options.repositoryUrl,
      projectPath: options.agentDirLabel,
      projectionMode: "eve-manifest",
    };
  }

  if (options.sourceDir === null) throw new Error("pass either --manifest or --source");
  const instructionsPath = join(options.sourceDir, "instructions.md");
  if (!existsSync(instructionsPath)) throw new Error(`${instructionsPath} does not exist`);

  return {
    declaration,
    instructions: await readFile(instructionsPath, "utf8"),
    tools: await readGithubSurface(options, declaredGithubToolNames(declarationRaw, options.declarationPath)),
    skills,
    repositoryUrl: options.repositoryUrl,
    projectPath: options.agentDirLabel,
    projectionMode: "source",
  };
}

async function main(): Promise<void> {
  const repositoryUrl = option("repository") ?? "https://github.com/wazootech/computer";
  const manifestPath = option("manifest") === undefined ? null : resolve(option("manifest") as string);
  const sourceDir = option("source") === undefined ? null : resolve(option("source") as string);
  const agentDirLabel = option("agent-dir") ?? "agent";
  const agentDir = resolve(sourceDir ?? agentDirLabel);
  const declarationPath = resolve(option("declaration") ?? join(agentDir, "agent-file-declaration.json"));
  const toolBindingsDir = option("tool-bindings") ?? "agent";
  const outputPath = resolve(option("out") ?? "agents/@wazootech/computer/computer.af");
  const checkOnly = process.argv.includes("--check");

  const source = await buildSource({
    repositoryUrl,
    manifestPath,
    sourceDir,
    agentDir,
    agentDirLabel,
    declarationPath,
    toolBindingsDir,
    // A compiled agent binds the whole GitHub surface it ships; an agent with no
    // eve build declares the subset it may call, in its declaration.
    githubTools: null,
  });
  const file = projectAgentFile(source);
  const serialized = serializeAgentFile(file);

  const validation = validateAgentFile(file);
  if (!validation.ok) throw new Error(`projection is not a valid agent file:\n  ${validation.errors.join("\n  ")}`);

  const findings = [...checkAgentFilePrivacy(file, source.declaration), ...checkProjectionIntegrity(file, source.instructions)];
  if (findings.length > 0) {
    throw new Error(
      `projection failed its privacy/integrity checks:\n  ${findings.map((finding) => `${finding.rule}: ${finding.detail}`).join("\n  ")}`,
    );
  }

  const shared = source.declaration.blocks.filter((block) => block.shareable).length;
  const summary = [
    `mode: ${source.projectionMode}`,
    `system prompt: ${source.instructions.length} characters`,
    `blocks: ${file.blocks.length} (${shared} with values, ${file.blocks.length - shared} schema-only)`,
    `tools: ${file.tools.length}`,
    `skills: ${file.skills.length}`,
  ].join(", ");

  if (checkOnly) {
    const current = existsSync(outputPath) ? await readFile(outputPath, "utf8") : null;
    if (current === null) {
      throw new Error(`${outputPath} does not exist; run the export without --check to write it`);
    }
    if (current !== serialized) {
      throw new Error(
        `${outputPath} is out of date with the source projection (${summary}). Regenerate it with:\n  node --experimental-strip-types scripts/export-agent-file.ts --manifest <manifest> --out ${outputPath}`,
      );
    }
    console.log(`agent file is up to date: ${outputPath} (${summary})`);
    return;
  }

  await writeFile(outputPath, serialized, "utf8");
  console.log(`wrote ${outputPath} (${summary})`);
}

main().catch((error: unknown) => {
  console.error(`export-agent-file failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
