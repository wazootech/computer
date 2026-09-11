import { defineTool } from "eve/tools";
import { z } from "zod";
import { mintInstallationToken } from "../../../lib/github/app-token.js";
import { repositoryRemoteUrl, repositoryTargetFromAuth } from "../../../lib/github/repository-target.js";
import { brokerPolicy, REPO_DIR, validateBranch } from "../../../lib/github/git-remote.js";

export default defineTool({
  description: `Push a committed feature branch of the verified repository checkout in ${REPO_DIR}. Main and master are refused.`,
  async execute(input, ctx) {
    const refusal = validateBranch(input.branch);
    if (refusal) return { error: refusal, success: false as const };
    const target = repositoryTargetFromAuth(ctx.session.auth);
    if (!target) return { error: "No verified GitHub repository is attached to this session.", success: false as const };
    const sandbox = await ctx.getSandbox();
    await sandbox.setNetworkPolicy(brokerPolicy(await mintInstallationToken()));
    try {
      const push = await sandbox.run({
        command: `git -C ${REPO_DIR} push ${repositoryRemoteUrl(target)} 'refs/heads/${input.branch}:refs/heads/${input.branch}'`,
      });
      if (push.exitCode !== 0) return { error: `git push exited ${push.exitCode}: ${String(push.stderr || push.stdout).trim()}`, success: false as const };
      const head = await sandbox.run({ command: `git -C ${REPO_DIR} rev-parse '${input.branch}'` });
      return { branch: input.branch, sha: String(head.stdout).trim(), success: true as const };
    } finally {
      await sandbox.setNetworkPolicy("allow-all");
    }
  },
  inputSchema: z.object({ branch: z.string().min(1) }),
});
