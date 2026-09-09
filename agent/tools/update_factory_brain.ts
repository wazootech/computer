import { defineTool } from "eve/tools";
import { z } from "zod";
import { factoryBrainKey, MAX_FACTORY_BRAIN_LENGTH } from "#lib/factory-brain.js";
import { writeMemoryProposal } from "#lib/memory/client.js";
import { factoryBrainPolicy } from "#lib/github/approval.js";
import { teamApprovalResponse } from "#lib/github/team-approval.js";

export default defineTool({
  approval: { request: factoryBrainPolicy, response: teamApprovalResponse },
  description: "Update the curated Computer factory brain in the private computer-memory repository. Read it first, merge only verified durable repository facts, and write the full document. The update is committed to a memory branch and draft PR.",
  inputSchema: z.object({ brain: z.string().min(1).max(MAX_FACTORY_BRAIN_LENGTH) }),
  outputSchema: z.object({ branch: z.string().optional(), error: z.string().optional(), pullRequestUrl: z.string().optional(), success: z.boolean() }),
  async execute({ brain }) {
    try {
      const result = await writeMemoryProposal({
        body: "Curated Computer factory brain update. It contains verified repository facts only.",
        contents: brain,
        path: factoryBrainKey(),
        title: "factory: update Computer brain",
      });
      return { branch: result.branch, pullRequestUrl: result.pullRequestUrl, success: true };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Failed to update the Computer factory brain", success: false };
    }
  },
});
