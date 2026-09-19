import { defineTool } from "eve/tools";
import { z } from "zod";
import { appendRunEvent } from "#lib/run-records.js";
import { repositoryTargetFromAuth } from "#lib/github/repository-target.js";

const usage = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  model: z.string().max(120).optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
});

export default defineTool({
  description: "Append one redacted software-factory stage, approval, output, or failure event to the canonical run history. Provide a stable idempotencyKey when replaying an external delivery or lifecycle event.",
  inputSchema: z.object({
    failure: z.unknown().optional(),
    idempotencyKey: z.string().min(1).max(300).optional(),
    kind: z.enum(["stage", "approval", "output", "failure"]),
    output: z.unknown().optional(),
    runId: z.string().min(1).max(160),
    stage: z.string().min(1).max(120),
    status: z.enum(["started", "completed", "pending", "approved", "rejected", "failed"]),
    summary: z.string().min(1).max(4000),
    usage: usage.optional(),
  }),
  outputSchema: z.object({ duplicate: z.boolean(), path: z.string() }),
  async execute(input, ctx) {
    const target = repositoryTargetFromAuth(ctx.session.auth);
    if (!target) throw new Error("No verified GitHub repository is attached to this session.");
    return appendRunEvent(input.runId, input, target, input.idempotencyKey);
  },
});
