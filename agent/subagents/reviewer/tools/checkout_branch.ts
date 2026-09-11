import { defineTool } from "eve/tools";
import { mintInstallationToken } from "../../../lib/github/app-token.js";
import { repositoryRemoteUrl, repositoryTargetFromAuth } from "../../../lib/github/repository-target.js";
import { z } from "zod";
import { brokerPolicy, REPO_DIR, validateBranch } from "../../../lib/github/git-remote.js";

export default defineTool({
  description: `Fetch an existing branch of the verified repository and check it out in ${REPO_DIR}.`,
  async execute(input, ctx) {
    const refusal = validateBranch(input.branch);
    if (refusal) return { error: refusal, success: false as const };
    const target = repositoryTargetFromAuth(ctx.session.auth);
    if (!target) return { error: "No verified GitHub repository is attached to this session.", success: false as const };
    const sandbox = await ctx.getSandbox();
    await sandbox.setNetworkPolicy(brokerPolicy(await mintInstallationToken()));
    try {
      const fetch = await sandbox.run({ command: `git -C ${REPO_DIR} fetch ${repositoryRemoteUrl(target)} '${input.branch}' && git -C ${REPO_DIR} checkout -B '${input.branch}' FETCH_HEAD` });
      if (fetch.exitCode !== 0) return { error: `git fetch/checkout exited ${fetch.exitCode}: ${String(fetch.stderr || fetch.stdout).trim()}`, success: false as const };
      const head = await sandbox.run({ command: `git -C ${REPO_DIR} rev-parse HEAD` });
      return { branch: input.branch, sha: String(head.stdout).trim(), success: true as const };
    } finally {
      await sandbox.setNetworkPolicy("allow-all");
    }
  },
  inputSchema: z.object({ branch: z.string().min(1) }),
});
