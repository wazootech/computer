import { defineTool } from "eve/tools";
import { z } from "zod";
import { cleanupExpiredRunHistory } from "#lib/run-history.js";
import { repositoryTargetFromAuth } from "#lib/github/repository-target.js";

export default defineTool({
  description: "Delete expired terminal run-history records for the verified repository. Active runs are never eligible for cleanup.",
  inputSchema: z.object({}),
  outputSchema: z.object({ deleted: z.number().int().nonnegative() }),
  async execute(_input, ctx) {
    const target = repositoryTargetFromAuth(ctx.session.auth);
    if (!target) return { deleted: 0 };
    return { deleted: await cleanupExpiredRunHistory(target) };
  },
});
