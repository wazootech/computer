export const REVIEW_DEPTHS = ["light", "standard", "deep"] as const;
export type ReviewDepth = (typeof REVIEW_DEPTHS)[number];

export const REVIEW_RISK_FACTORS = [
  "documentation",
  "public_api",
  "security",
  "permissions",
  "migration",
  "data",
  "deployment",
  "runtime",
  "unknown",
] as const;
export type ReviewRiskFactor = (typeof REVIEW_RISK_FACTORS)[number];

export type ReviewPolicyInput = Readonly<{
  workType?: string;
  priority?: string;
  complexity?: string;
  affectedArea?: string;
  affectedSurface?: readonly string[];
  changedPaths?: readonly string[];
}>;

export type ReviewPolicy = Readonly<{
  depth: ReviewDepth;
  riskFactors: readonly ReviewRiskFactor[];
  rationale: string;
  requiredChecks: readonly string[];
  evidenceRequirements: readonly string[];
  humanEscalation: boolean;
}>;

const HIGH_RISK_PATTERNS: readonly [ReviewRiskFactor, RegExp][] = [
  ["security", /(^|\/)(auth|authentication|authorization|crypto|secret|token|trust|webhook|security)(\/|\.|$)|password|credential|signature|redact/i],
  ["permissions", /(^|\/)(approval|permission|policy|access|rbac|acl)(\/|\.|$)|allowlist|denylist|privilege/i],
  ["migration", /(^|\/)(migrations?|schema|database|db)(\/|\.|$)|backfill|alter table/i],
  ["public_api", /(^|\/)(api|routes?|public|openapi|graphql)(\/|\.|$)|\.d\.ts$|breaking.?change/i],
  ["data", /(^|\/)(blob|storage|persistence|records?|data)(\/|\.|$)|retention|serialization/i],
  ["deployment", /(^|\/)(\.github|deploy|deployment|infra|terraform|docker)(\/|\.|$)|vercel|workflow/i],
  ["runtime", /(^|\/)(agent|channels?|hooks?|subagents?|tools?)(\/|\.|$)|package\.json|lockfile/i],
];

const DOC_PATTERN = /(^|\/)(docs?|documentation)(\/|$)|(^|\/)(readme|changelog|contributing)(\.[^/]+)?$|\.(md|mdx|mdoc|adoc|rst)$/i;

const normalize = (value: string | undefined): string => value?.trim().toLowerCase() ?? "";

function isDocumentationPath(path: string): boolean {
  return DOC_PATTERN.test(path.replaceAll("\\", "/"));
}

function factorForPath(path: string): ReviewRiskFactor | undefined {
  const normalized = path.replaceAll("\\", "/");
  return HIGH_RISK_PATTERNS.find(([, pattern]) => pattern.test(normalized))?.[0];
}

function uniqueFactors(factors: readonly ReviewRiskFactor[]): ReviewRiskFactor[] {
  return [...new Set(factors)];
}

export function classifyReviewDepth(input: ReviewPolicyInput): ReviewPolicy {
  const paths = [...(input.changedPaths ?? []), ...(input.affectedSurface ?? [])].filter(Boolean);
  const pathFactors = paths.flatMap((path) => {
    const factor = factorForPath(path);
    return factor ? [factor] : [];
  });
  const workType = normalize(input.workType);
  const priority = normalize(input.priority);
  const complexity = normalize(input.complexity);
  const affectedArea = normalize(input.affectedArea);
  const factors = uniqueFactors([
    ...(paths.length > 0 && paths.every(isDocumentationPath) ? ["documentation" as const] : []),
    ...pathFactors,
    ...(workType === "security" ? ["security" as const] : []),
    ...(affectedArea.includes("security") || affectedArea.includes("auth") ? ["security" as const] : []),
    ...(affectedArea.includes("permission") || affectedArea.includes("access") ? ["permissions" as const] : []),
    ...(paths.length === 0 && !workType && !affectedArea ? ["unknown" as const] : []),
  ]);
  const highRisk = factors.some((factor) => factor !== "documentation") || priority === "critical";
  const docsOnly = factors.includes("documentation") && !highRisk;
  const depth: ReviewDepth = docsOnly ? "light" : highRisk ? "deep" : "standard";
  const riskFactors = factors.length > 0 ? factors : ["unknown" as const];
  const rationale = docsOnly
    ? "Only documentation paths are in scope and no high-risk signal was found."
    : highRisk
      ? `High-risk review required for ${riskFactors.filter((factor) => factor !== "documentation").join(", ")}${priority === "critical" ? ` at ${priority} priority` : ""}.`
      : `Standard review required for ${complexity || "unclassified"} work without a documentation-only or high-risk signal.`;

  if (depth === "light") {
    return {
      depth,
      riskFactors,
      rationale,
      requiredChecks: [
        "Inspect the complete documentation diff and confirm the requested content is present.",
        "Run the repository's documentation, link, or formatting check when one exists.",
        "Run focused tests for any executable examples or generated documentation that changed.",
      ],
      evidenceRequirements: [
        "Changed-file list with the documentation paths reviewed.",
        "Verification command results, or an explicit note that no documentation check exists.",
        "Acceptance-criterion results with links or file references.",
      ],
      humanEscalation: false,
    };
  }

  if (depth === "standard") {
    return {
      depth,
      riskFactors,
      rationale,
      requiredChecks: [
        "Inspect the complete diff against every acceptance criterion.",
        "Run the narrowest relevant tests, typecheck, or lint checks and report their results.",
        "Check scope, compatibility, and deviations from the analysis.",
      ],
      evidenceRequirements: [
        "Changed-file list and affected-surface mapping.",
        "Verification commands and results.",
        "Acceptance-criterion results and any remaining limitations.",
      ],
      humanEscalation: false,
    };
  }

  return {
    depth,
    riskFactors,
    rationale,
    requiredChecks: [
      "Inspect the complete diff and trace every public, security, permission, migration, data, deployment, or runtime change.",
      "Run targeted validation plus the strongest applicable repository checks, including typecheck, tests, build, or migration validation.",
      "Check backward compatibility, failure recovery, rollback or migration safety, and authorization boundaries.",
      "Stop and record any unresolved high-risk finding instead of treating a passing narrow test as sufficient.",
    ],
    evidenceRequirements: [
      "Changed-file list mapped to each risk factor.",
      "Analysis or probes performed and their findings.",
      "All relevant commands and results, including skipped checks with reasons.",
      "Explicit review verdict, unresolved limitations, and human-escalation note before readiness.",
    ],
    humanEscalation: true,
  };
}
