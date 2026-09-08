import { defineTool } from "eve/tools";
import { z } from "zod";
import { runPreflight } from "../../lib/preflight.ts";

export default defineTool({
  description: "Verify Computer's GitHub App installation permission, approver-team access, and DeepSeek runtime without returning secrets.",
  inputSchema: z.object({
    checkDeepSeek: z.boolean().default(true),
    teamSlug: z.string().min(1).default("team"),
  }),
  async execute({ checkDeepSeek, teamSlug }) {
    return runPreflight(process.env, fetch, { checkDeepSeek, team: teamSlug });
  },
});
