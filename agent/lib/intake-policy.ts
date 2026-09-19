import {
  FACTORY_BLOCKED_LABEL,
  FACTORY_CANDIDATE_LABEL,
  FACTORY_COMPLETED_LABEL,
  FACTORY_DUPLICATE_LABEL,
  FACTORY_FAILED_LABEL,
  FACTORY_MANUAL_LABEL,
  FACTORY_NEEDS_CLARIFICATION_LABEL,
  FACTORY_PROMOTED_LABEL,
  FACTORY_QUEUED_LABEL,
  FACTORY_RUNNING_LABEL,
  INTAKE_CLASSIFICATION_LABELS,
  isFactoryStateLabel,
} from "./constants.ts";

export type IntakeState =
  | "queued"
  | "needs_clarification"
  | "duplicate"
  | "blocked"
  | "running"
  | "failed"
  | "manual"
  | "completed";

const stateLabels: Record<IntakeState, string> = {
  blocked: FACTORY_BLOCKED_LABEL,
  completed: FACTORY_COMPLETED_LABEL,
  duplicate: FACTORY_DUPLICATE_LABEL,
  failed: FACTORY_FAILED_LABEL,
  manual: FACTORY_MANUAL_LABEL,
  needs_clarification: FACTORY_NEEDS_CLARIFICATION_LABEL,
  queued: FACTORY_QUEUED_LABEL,
  running: FACTORY_RUNNING_LABEL,
};

const allowedTransitions: Record<string, readonly IntakeState[]> = {
  [FACTORY_CANDIDATE_LABEL]: ["blocked", "duplicate", "needs_clarification", "queued"],
  [FACTORY_NEEDS_CLARIFICATION_LABEL]: ["blocked", "queued"],
  [FACTORY_QUEUED_LABEL]: ["running"],
  [FACTORY_PROMOTED_LABEL]: ["running"],
  [FACTORY_RUNNING_LABEL]: ["completed", "failed", "manual"],
};

export function labelForIntakeState(state: IntakeState): string {
  return stateLabels[state];
}

export function intakeStateForLabels(labels: readonly string[]): IntakeState | null {
  for (const [state, label] of Object.entries(stateLabels) as [IntakeState, string][]) {
    if (labels.includes(label)) return state;
  }
  return null;
}

export function canTransitionIntakeState(
  currentLabels: readonly string[],
  next: IntakeState,
  hasWayfinderTask: boolean,
): boolean {
  const current = currentLabels.find((label) => allowedTransitions[label]);
  if (next === "queued" && !hasWayfinderTask) return false;
  if (current === undefined) return next === "queued" && hasWayfinderTask;
  return allowedTransitions[current]?.includes(next) ?? false;
}

export function isAllowedIntakeClassificationLabel(label: string): boolean {
  return INTAKE_CLASSIFICATION_LABELS.includes(label);
}

export function isAllowedIntakeLabel(label: string): boolean {
  return isFactoryStateLabel(label) || isAllowedIntakeClassificationLabel(label);
}

export function stateLabelsForTransition(currentLabels: readonly string[], next: IntakeState): {
  add: string[];
  remove: string[];
} {
  const nextLabel = labelForIntakeState(next);
  const remove = currentLabels.filter((label) => isFactoryStateLabel(label) && label !== nextLabel);
  return { add: [nextLabel], remove };
}
