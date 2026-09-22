import { defineTool } from "eve/tools";
import { z } from "zod";
import { classifyReviewDepth } from "../../lib/review-policy.ts";

const optionalText = z.string().max(300).optional();

export default defineTool({
  description: "Select the minimum review depth for a work item from its classification and affected surfaces. Documentation-only work may be light; high-impact contract, security, permission, migration, data, deployment, runtime, or critical work is deep and requires explicit human escalation.",
  inputSchema: z.object({
    affectedArea: optionalText,
    affectedSurface: z.array(z.string().max(500)).max(200).default([]),
    changedPaths: z.array(z.string().max(500)).max(500).default([]),
    complexity: optionalText,
    priority: optionalText,
    workType: optionalText,
  }),
  outputSchema: {
    type: "object",
    properties: {
      depth: {
        type: "string",
        enum: ["light", "standard", "deep"],
      },
      rationale: {
        type: "string",
      },
      riskFactors: {
        type: "array",
        items: {
          type: "string",
        },
      },
      requiredChecks: {
        type: "array",
        items: {
          type: "string",
        },
      },
      evidenceRequirements: {
        type: "array",
        items: {
          type: "string",
        },
      },
      humanEscalation: {
        type: "boolean",
      },
    },
    required: ["depth", "rationale", "riskFactors", "requiredChecks", "evidenceRequirements", "humanEscalation"],
    additionalProperties: false,
  },
  execute(input) {
    return classifyReviewDepth(input);
  },
});
