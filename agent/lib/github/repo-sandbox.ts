import type { SandboxSessionContext } from "eve/sandbox";
import { FACTORY_SANDBOX_CREATE_OPTIONS } from "./repo-sandbox-options.js";
import {
  repositoryRemoteUrl,
  repositoryTargetFromAuth,
} from "./repository-target.js";
import { mintInstallationToken } from "./app-token.js";
import { brokerPolicy, REPO_DIR } from "./git-remote.js";

export { FACTORY_SANDBOX_CREATE_OPTIONS };

async function runOrThrow(
  sandbox: Awaited<ReturnType<SandboxSessionContext["use"]>>,
  command: string
): Promise<void> {
  const result = await sandbox.run({ command });
  if (result.exitCode !== 0) {
    throw new Error(
      `Sandbox command failed (exit ${result.exitCode}): ${String(
        result.stderr || result.stdout
      ).trim()}`
    );
  }
}

export async function factoryOnSession({
  ctx,
  use,
}: SandboxSessionContext): Promise<void> {
  const target = repositoryTargetFromAuth(ctx.session.auth);
  const sandbox = await use();
  await runOrThrow(
    sandbox,
    `git config --global --add safe.directory /workspace && git config --global --add safe.directory ${REPO_DIR}`
  );
  if (!target) return;

  const token = await mintInstallationToken();
  await sandbox.setNetworkPolicy(brokerPolicy(token));
  try {
    await runOrThrow(sandbox, `rm -rf ${REPO_DIR}`);
    await runOrThrow(
      sandbox,
      `git clone --depth 50 ${repositoryRemoteUrl(target)} ${REPO_DIR}`
    );
    const identity = target.owner === "wazootech" ? "wazoocomputer[bot]" : "Computer[bot]";
    const email = target.owner === "wazootech" ? "wazoocomputer[bot]@users.noreply.github.com" : "computer[bot]@users.noreply.github.com";
    await runOrThrow(
      sandbox,
      `git -C ${REPO_DIR} config user.name "${identity}" && git -C ${REPO_DIR} config user.email "${email}"`
    );
    const setup = process.env.FACTORY_SETUP_COMMAND;
    if (setup) await runOrThrow(sandbox, `cd ${REPO_DIR} && ${setup}`);
  } finally {
    await sandbox.setNetworkPolicy("allow-all");
  }
}
