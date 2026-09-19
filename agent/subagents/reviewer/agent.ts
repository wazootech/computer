import { defineAgent } from "eve";
import { MODELS } from "../../lib/models.js";

/**
 * Station 4: independent review.
 *
 * @remarks
 * Runs on a different model vendor than the implementer on purpose: fresh
 * eyes are the station's point, and a different model doesn't share the
 * implementer's idiom or blind spots. It fetches the pushed branch into its
 * own checkout and judges the real diff against the analyst's acceptance
 * criteria; it never modifies code. Its verdict routes the pipeline: approve
 * ships a draft PR, request_changes loops back to the implementer (at most
 * twice), reject stops the line.
 */
export default defineAgent({
  description:
    "Independently review a pushed factory branch against the original work item and its " +
    "acceptance criteria: fetch the branch, read the real diff, re-run the checks required " +
    "by the supplied risk-scaled review policy, and return approve, request_changes, or " +
    "reject with specific findings. Never modifies code. The caller passes the work item, " +
    "the analysis with acceptance criteria, the branch name, the implementer's report, and " +
    "the selected review policy in the message, plus an artifact id when the analyst saved " +
    "its full detail as one.",
  model: MODELS.reviewer,
  outputSchema: {
    additionalProperties: false,
    properties: {
      blocking_findings: {
        description:
          "Problems that block shipping: each names where it is, what is wrong, and why it matters.",
        items: { type: "string" },
        type: "array",
      },
      criteria_results: {
        description:
          "One entry per acceptance criterion from the analysis, judged individually.",
        items: {
          additionalProperties: false,
          properties: {
            criterion: {
              description: "The acceptance criterion, verbatim.",
              type: "string",
            },
            evidence: {
              description:
                "What in the diff or verification output shows it passing or failing.",
              type: "string",
            },
            pass: { type: "boolean" },
          },
          required: ["criterion", "pass", "evidence"],
          type: "object",
        },
        type: "array",
      },
      depth_assessment: {
        additionalProperties: false,
        description:
          "The final review-depth assessment after inspecting the actual diff. Upgrade the caller's policy when changed paths reveal greater risk.",
        properties: {
          depth: { enum: ["light", "standard", "deep"], type: "string" },
          human_escalation: { type: "boolean" },
          rationale: { type: "string" },
          risk_factors: { items: { type: "string" }, type: "array" },
        },
        required: ["depth", "risk_factors", "rationale", "human_escalation"],
        type: "object",
      },
      evidence_collected: {
        description:
          "Evidence collected at the selected depth: probes, affected files, commands, results, and any gaps.",
        items: { type: "string" },
        type: "array",
      },
      required_checks: {
        description: "Checks required by the selected depth and whether each was completed.",
        items: { type: "string" },
        type: "array",
      },
      suggestions: {
        description: "Advisory notes that do not block shipping.",
        items: { type: "string" },
        type: "array",
      },
      summary: {
        description: "One paragraph: the verdict and what drove it.",
        type: "string",
      },
      verdict: {
        enum: ["approve", "request_changes", "reject"],
        type: "string",
      },
    },
    required: [
      "verdict",
      "depth_assessment",
      "required_checks",
      "evidence_collected",
      "criteria_results",
      "blocking_findings",
      "suggestions",
      "summary",
    ],
    type: "object",
  },
});
