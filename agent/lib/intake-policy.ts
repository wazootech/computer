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
  FACTORY_STATE_LABELS,
  INTAKE_CLASSIFICATION_LABELS,
  isFactoryStateLabel,
} from "./constants.ts";

export type IntakeState =
  | "blocked"
  | "candidate"
  | "completed"
  | "duplicate"
  | "failed"
  | "manual"
  | "needs_clarification"
  | "promoted"
  | "queued"
  | "running";

const stateLabels: Record<IntakeState, string> = {
  blocked: FACTORY_BLOCKED_LABEL,
  candidate: FACTORY_CANDIDATE_LABEL,
  completed: FACTORY_COMPLETED_LABEL,
  duplicate: FACTORY_DUPLICATE_LABEL,
  failed: FACTORY_FAILED_LABEL,
  manual: FACTORY_MANUAL_LABEL,
  needs_clarification: FACTORY_NEEDS_CLARIFICATION_LABEL,
  promoted: FACTORY_PROMOTED_LABEL,
  queued: FACTORY_QUEUED_LABEL,
  running: FACTORY_RUNNING_LABEL,
};

const allowedTransitions: Record<IntakeState, readonly IntakeState[]> = {
  blocked: [],
  candidate: ["blocked", "duplicate", "needs_clarification", "queued"],
  completed: [],
  duplicate: [],
  failed: [],
  manual: [],
  needs_clarification: ["blocked", "queued"],
  promoted: ["running"],
  queued: ["promoted", "running"],
  running: ["completed", "failed", "manual"],
};

export function labelForIntakeState(state: IntakeState): string {
  return stateLabels[state];
}

export function intakeStateForLabels(labels: readonly string[]): IntakeState | null {
  const present = FACTORY_STATE_LABELS.filter((label) => labels.includes(label));
  if (present.includes(FACTORY_PROMOTED_LABEL)) {
    return present.length === 2 && present.includes(FACTORY_QUEUED_LABEL) ? "promoted" : null;
  }
  if (present.length !== 1) return null;
  const entry = (Object.entries(stateLabels) as [IntakeState, string][]).find(([, label]) => label === present[0]);
  return entry?.[0] ?? null;
}

export function canTransitionIntakeState(
  currentLabels: readonly string[],
  next: IntakeState,
  hasWayfinderTask: boolean,
): boolean {
  if (next === "queued" && !hasWayfinderTask) return false;
  const current = intakeStateForLabels(currentLabels);
  return current !== null && (current === next || allowedTransitions[current].includes(next));
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

export function planIntakeStateTransition(
  currentLabels: readonly string[],
  next: IntakeState,
  hasWayfinderTask: boolean,
): { duplicate: boolean; add: string[]; remove: string[] } {
  const current = intakeStateForLabels(currentLabels);
  if (current === null) throw new Error("Issue has missing or conflicting factory state labels.");
  if (current === next) return { duplicate: true, add: [], remove: [] };
  if (!canTransitionIntakeState(currentLabels, next, hasWayfinderTask)) {
    throw new Error(`Illegal intake state transition from ${current} to ${next}`);
  }
  return { duplicate: false, ...stateLabelsForTransition(currentLabels, next) };
}
