import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runRepeatabilityReplay } from "../lib/acceptance/repeatability.ts";
import type { AcceptanceTarget } from "../lib/preflight.ts";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function required(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`missing --${name}`);
  return value;
}

async function main(): Promise<void> {
  if (process.argv.includes("--live")) {
    throw new Error("live mode is intentionally not implemented by the safe repeatability command; use the explicitly guarded Eve eval instead");
  }
  const target: AcceptanceTarget = {
    baseSha: required("base-sha"),
    disposable: option("disposable") === "true",
    issueNumber: Number(required("issue")),
    repository: required("repository"),
    worktree: required("worktree"),
  };
  const evidence = runRepeatabilityReplay(target);
  const outputDirectory = option("output") ?? ".eve/acceptance-repeatability";
  const outputPath = join(outputDirectory, `${new Date().toISOString().replaceAll(/[:.]/gu, "-")}.json`);
  try {
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify({ outputPath, outcome: evidence.outcome, traceDigests: evidence.runs.map((run) => run.traceDigest) }));
    if (evidence.outcome !== "success") process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "acceptance harness failed");
    process.exitCode = 1;
  }
}

await main();
