import { defineTool } from "eve/tools";
import { z } from "zod";
import { readLegacyRunRecord, readRunHistory } from "#lib/run-records.js";
import { repositoryTargetFromAuth } from "#lib/github/repository-target.js";

export default defineTool({
  description: "Read a canonical redacted Computer software-factory run history by its stable run ID. The history contains lifecycle events, approvals, stage lineage, outcomes, and no raw credentials or customer content.",
  inputSchema: z.object({ runId: z.string().min(1).max(160) }),
  outputSchema: z.object({ found: z.boolean(), path: z.string(), record: z.string(), error: z.string().optional() }),
  async execute({ runId }, ctx) {
    const target = repositoryTargetFromAuth(ctx.session.auth);
    if (!target) return { error: "No verified GitHub repository is attached to this session.", found: false, path: "", record: "" };
    try {
      const result = await readRunHistory(target, runId);
      if (result.found) {
        return { found: true, path: result.path, record: JSON.stringify(result.record, null, 2) };
      }
      const legacy = await readLegacyRunRecord(target, runId);
      return "content" in legacy
        ? { found: true, path: legacy.path, record: legacy.content }
        : { found: false, path: legacy.path, record: "" };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Failed to read run history", found: false, path: "", record: "" };
    }
  },
});
