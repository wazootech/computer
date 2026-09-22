import { defineTool } from "eve/tools";
import { z } from "zod";
import { runPreflight } from "../../lib/preflight.ts";
import { repositoryTargetFromAuth } from "#lib/github/repository-target.js";

export default defineTool({
  description:
    "Verify Computer's GitHub App installation permission, approver-team access, and model runtime without returning secrets. Reports which repository the session would work on and whether the App installation covers it; pass `repository` to check another owner/name.",
  inputSchema: z.object({
    checkModel: z.boolean().default(true),
    repository: z.string().min(1).optional(),
    teamSlug: z.string().min(1).default("team"),
  }),
  async execute({ checkModel, repository, teamSlug }, ctx) {
    const attached = repositoryTargetFromAuth(ctx.session.auth);
    return runPreflight(process.env, fetch, {
      checkModel,
      repository: repository ?? attached?.fullName,
      team: teamSlug,
    });
  },
});
