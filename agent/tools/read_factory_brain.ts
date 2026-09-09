import { defineTool } from "eve/tools";
import { z } from "zod";
import { factoryBrainKey } from "#lib/factory-brain.js";
import { readMemoryDocument } from "#lib/memory/client.js";

export default defineTool({
  description: "Load the curated Computer factory brain from the private computer-memory repository. Use it at the start of a task; it contains verified build quirks, conventions, and recurring review findings, never secrets.",
  inputSchema: z.object({}),
  outputSchema: z.object({ brain: z.string(), error: z.string().optional(), found: z.boolean() }),
  async execute() {
    try {
      const document = await readMemoryDocument(factoryBrainKey());
      return document ? { brain: document.content, found: true } : { brain: "", found: false };
    } catch (error) {
      return { brain: "", error: error instanceof Error ? error.message : "Failed to load the Computer factory brain", found: false };
    }
  },
});
