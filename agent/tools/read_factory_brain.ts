import { defineTool } from "eve/tools";
import { z } from "zod";
import { readDocument } from "#lib/blob.js";
import { factoryBrainKey } from "#lib/factory-brain.js";
import { repositoryTargetFromAuth } from "#lib/github/repository-target.js";

/**
 * Tool that loads the shared factory brain from Vercel Blob.
 *
 * @remarks
 * The Blob key is derived from the verified repository identity in session auth, never from model input, so each repository reads its own
 * shared document (see `factoryBrainKey`). Reading is unrestricted:
 * every run, unattended included, may load the brain for context. Returns `found: false` with an
 * empty `brain` when nothing has been recorded yet, which is a normal state, not an error.
 * Authorization resolves from the ambient Vercel OIDC credentials.
 */
export default defineTool({
  description:
    "Load the factory brain: durable, shared notes about the target repository (build quirks, " +
    "verification gotchas, recurring review findings, conventions). Call it at the start of a " +
    "task and weave relevant facts into the messages you send stations, since stations can't " +
    "read it themselves. Returns empty when the brain has nothing yet.",
  /**
   * Read the factory brain document.
   *
   * @param _input - No input.
   * @returns `found` plus the `brain` Markdown (empty when none), or an `error`.
   */
  async execute(_input, ctx) {
    const target = repositoryTargetFromAuth(ctx.session.auth);
    if (!target) return { brain: "", found: false, error: "No verified GitHub repository is attached to this session." };
    const key = factoryBrainKey(target);
    try {
      const doc = await readDocument(key);
      if (!doc.found) {
        return { brain: "", found: false };
      }
      return { brain: doc.content, found: true };
    } catch (error) {
      return {
        brain: "",
        error:
          error instanceof Error
            ? error.message
            : "Failed to load the factory brain",
        found: false,
      };
    }
  },
  inputSchema: z.object({}),
  outputSchema: z.object({
    brain: z.string(),
    error: z.string().optional(),
    found: z.boolean(),
  }),
});
