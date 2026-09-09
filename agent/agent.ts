import { defineAgent } from "eve";
import { MODELS } from "./lib/models.js";

export default defineAgent({
  compaction: { thresholdPercent: 0.75 },
  limits: {
    maxOutputTokensPerSession: 100_000,
  },
  model: MODELS.orchestrator,
});
