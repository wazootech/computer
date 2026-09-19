export const COMPUTER_APPROVER_ORG = process.env.COMPUTER_APPROVER_ORG ?? "wazootech";
export const COMPUTER_APPROVER_TEAM = process.env.COMPUTER_APPROVER_TEAM ?? "team";
export const FACTORY_BRANCH_PREFIX = process.env.FACTORY_BRANCH_PREFIX ?? "factory/";

export const FACTORY_CANDIDATE_LABEL = process.env.FACTORY_CANDIDATE_LABEL ?? "factory:candidate";
export const FACTORY_QUEUED_LABEL = process.env.FACTORY_QUEUED_LABEL ?? "factory:queued";
export const FACTORY_NEEDS_CLARIFICATION_LABEL = process.env.FACTORY_NEEDS_CLARIFICATION_LABEL ?? "factory:needs-clarification";
export const FACTORY_DUPLICATE_LABEL = process.env.FACTORY_DUPLICATE_LABEL ?? "factory:duplicate";
export const FACTORY_BLOCKED_LABEL = process.env.FACTORY_BLOCKED_LABEL ?? "factory:blocked";
export const FACTORY_PROMOTED_LABEL = process.env.FACTORY_PROMOTED_LABEL ?? "factory:promoted";
export const FACTORY_RUNNING_LABEL = process.env.FACTORY_RUNNING_LABEL ?? "factory:running";
export const FACTORY_FAILED_LABEL = process.env.FACTORY_FAILED_LABEL ?? "factory:failed";
export const FACTORY_MANUAL_LABEL = process.env.FACTORY_MANUAL_LABEL ?? "factory:manual";
export const FACTORY_COMPLETED_LABEL = process.env.FACTORY_COMPLETED_LABEL ?? "factory:completed";
export const WAYFINDER_TASK_LABEL = process.env.WAYFINDER_TASK_LABEL ?? "wayfinder:task";

export const FACTORY_STATE_LABELS = [
  FACTORY_CANDIDATE_LABEL,
  FACTORY_QUEUED_LABEL,
  FACTORY_NEEDS_CLARIFICATION_LABEL,
  FACTORY_DUPLICATE_LABEL,
  FACTORY_BLOCKED_LABEL,
  FACTORY_PROMOTED_LABEL,
  FACTORY_RUNNING_LABEL,
  FACTORY_FAILED_LABEL,
  FACTORY_MANUAL_LABEL,
  FACTORY_COMPLETED_LABEL,
] as const;

export const FACTORY_TERMINAL_LABELS = [
  FACTORY_DUPLICATE_LABEL,
  FACTORY_BLOCKED_LABEL,
  FACTORY_FAILED_LABEL,
  FACTORY_MANUAL_LABEL,
  FACTORY_COMPLETED_LABEL,
] as const;

export const INTAKE_CLASSIFICATION_LABELS = (process.env.FACTORY_INTAKE_ALLOWED_LABELS ??
  "bug,documentation,enhancement,good first issue,help wanted,question,wayfinder:task").split(",").map((label) => label.trim()).filter(Boolean);

export function validateFactoryLabelConfiguration(environment: Record<string, string | undefined> = process.env): string[] {
  const candidate = environment.FACTORY_CANDIDATE_LABEL?.trim() || FACTORY_CANDIDATE_LABEL;
  const promoted = environment.FACTORY_PROMOTED_LABEL?.trim() || FACTORY_PROMOTED_LABEL;
  const terminal = [
    environment.FACTORY_DUPLICATE_LABEL?.trim() || FACTORY_DUPLICATE_LABEL,
    environment.FACTORY_BLOCKED_LABEL?.trim() || FACTORY_BLOCKED_LABEL,
    environment.FACTORY_FAILED_LABEL?.trim() || FACTORY_FAILED_LABEL,
    environment.FACTORY_MANUAL_LABEL?.trim() || FACTORY_MANUAL_LABEL,
    environment.FACTORY_COMPLETED_LABEL?.trim() || FACTORY_COMPLETED_LABEL,
  ];
  const labels = [candidate, environment.FACTORY_QUEUED_LABEL?.trim() || FACTORY_QUEUED_LABEL, environment.FACTORY_NEEDS_CLARIFICATION_LABEL?.trim() || FACTORY_NEEDS_CLARIFICATION_LABEL, ...terminal, promoted];
  const errors: string[] = [];
  if (labels.some((label) => label.length === 0)) errors.push("factory state labels must be non-empty");
  if (new Set(labels).size !== labels.length) errors.push("factory state labels must be unique");
  if (candidate === promoted) errors.push("candidate and promotion labels must differ");
  if (terminal.includes(candidate)) errors.push("candidate label cannot be terminal");
  if (terminal.includes(promoted)) errors.push("promotion label cannot be terminal");
  return errors;
}

export function isFactoryStateLabel(label: string): boolean {
  return FACTORY_STATE_LABELS.includes(label as (typeof FACTORY_STATE_LABELS)[number]);
}
