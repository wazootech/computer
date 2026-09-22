import { defineTool } from "eve/tools";
import { z } from "zod";
import { classifyReviewDepth } from "../../../../lib/review-policy.ts";

const optionalText = z.string().max(300).optional();

export default defineTool({
  description: "Reassess the minimum review depth from the actual changed paths and the supplied work-item signals. Never downgrade a high-risk change to the light path.",
  inputSchema: z.object({
    affectedArea: optionalText,
    affectedSurface: z.array(z.string().max(500)).max(200).default([]),
    changedPaths: z.array(z.string().max(500)).max(500),
    complexity: optionalText,
    priority: optionalText,
    workType: optionalText,
  }),
  outputSchema: {
    additionalProperties: false,
    properties: {
      depth: { enum: ["light", "standard", "deep"], type: "string" },
      rationale: { type: "string" },
      riskFactors: { items: { type: "string" }, type: "array" },
      requiredChecks: { items: { type: "string" }, type: "array" },
      evidenceRequirements: { items: { type: "string" }, type: "array" },
      humanEscalation: { type: "boolean" },
    },
    required: ["depth", "rationale", "riskFactors", "requiredChecks", "evidenceRequirements", "humanEscalation"],
    type: "object",
  },
  execute(input) {
    return classifyReviewDepth(input);
  },
});
