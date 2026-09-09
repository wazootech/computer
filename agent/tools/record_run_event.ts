import { defineTool } from "eve/tools";
import { z } from "zod";
import { appendRunEvent } from "#lib/memory/client.js";

const usage = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  model: z.string().max(120).optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
});

export default defineTool({
  description: "Append one redacted software-factory stage, approval, output, or failure event to an existing Computer run record. Summaries and outputs must be concise and must not contain credentials or raw customer data.",
  inputSchema: z.object({
    failure: z.unknown().optional(),
    kind: z.enum(["stage", "approval", "output", "failure"]),
    output: z.unknown().optional(),
    runId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u),
    stage: z.string().min(1).max(120),
    status: z.enum(["started", "completed", "pending", "approved", "rejected", "failed"]),
    summary: z.string().min(1).max(4000),
    usage: usage.optional(),
  }),
  outputSchema: z.object({ branch: z.string(), path: z.string() }),
  async execute(input) {
    return appendRunEvent(input.runId, input);
  },
});
