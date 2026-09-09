import { defineTool } from "eve/tools";
import { z } from "zod";
import { startRunRecord } from "#lib/memory/client.js";

export default defineTool({
  description: "Start a Computer software-factory run by creating a redacted run record and draft PR in the private computer-memory repository. Never include credentials or raw customer content in the title or summary.",
  inputSchema: z.object({
    runId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u).optional(),
    summary: z.string().min(1).max(4000),
    title: z.string().min(1).max(240),
  }),
  outputSchema: z.object({ branch: z.string(), path: z.string(), pullRequestUrl: z.string(), runId: z.string() }),
  async execute(input) {
    return startRunRecord(input);
  },
});
