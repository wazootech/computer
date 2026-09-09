import { defineTool } from "eve/tools";
import { z } from "zod";
import { readDocument } from "#lib/blob.js";
import { runRecordPath } from "#lib/run-records.js";

export default defineTool({
  description: "Read a redacted Computer software-factory run record from Vercel Blob by run ID. Use this for status and handoff context; records contain no credentials.",
  inputSchema: z.object({ runId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u) }),
  outputSchema: z.object({ found: z.boolean(), path: z.string(), record: z.string(), error: z.string().optional() }),
  async execute({ runId }) {
    const path = runRecordPath(runId);
    try {
      const document = await readDocument(path);
      return document.found
        ? { found: true, path, record: document.content }
        : { found: false, path, record: "" };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Failed to read run record", found: false, path, record: "" };
    }
  },
});
