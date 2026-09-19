import { defineTool } from "eve/tools";
import { z } from "zod";
import { listRunHistory, type RunHistoryStatus } from "#lib/run-history.js";
import { repositoryTargetFromAuth } from "#lib/github/repository-target.js";

const statuses: [RunHistoryStatus, ...RunHistoryStatus[]] = ["running", "waiting", "completed", "failed", "cancelled", "expired", "manual"];

export default defineTool({
  description: "List canonical redacted Computer run-history summaries for the verified repository, newest first.",
  inputSchema: z.object({
    deliveryId: z.string().min(1).max(300).optional(),
    includeExpired: z.boolean().optional(),
    issueNumber: z.number().int().positive().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    pullRequestNumber: z.number().int().positive().optional(),
    status: z.enum(statuses).optional(),
  }),
  outputSchema: z.object({ runs: z.array(z.unknown()) }),
  async execute(input, ctx) {
    const target = repositoryTargetFromAuth(ctx.session.auth);
    if (!target) return { runs: [] };
    return { runs: await listRunHistory(target, input) };
  },
});
