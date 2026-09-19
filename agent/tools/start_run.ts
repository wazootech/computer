import { defineTool } from "eve/tools";
import { z } from "zod";
import { startRunRecord } from "#lib/run-records.js";
import { repositoryTargetFromAuth } from "#lib/github/repository-target.js";

export default defineTool({
  description: "Ensure the canonical redacted Computer run history exists for the current verified repository. If runId is omitted, the current Eve session ID is used as the stable retrievable run ID.",
  inputSchema: z.object({
    runId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u).optional(),
    summary: z.string().min(1).max(4000),
    title: z.string().min(1).max(240),
  }),
  outputSchema: z.object({ duplicate: z.boolean(), path: z.string(), runId: z.string() }),
  async execute(input, ctx) {
    const target = repositoryTargetFromAuth(ctx.session.auth);
    if (!target) throw new Error("No verified GitHub repository is attached to this session.");
    return startRunRecord({ ...input, runId: input.runId ?? ctx.session.id }, target);
  },
});
