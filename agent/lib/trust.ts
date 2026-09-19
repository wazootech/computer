import type { SessionAuthContext } from "eve/context";

export const AUTONOMOUS_PRINCIPAL = "github:foreman-factory";
export const TRUSTED_ATTRIBUTE = "trusted";
export const INTAKE_ISSUE_ATTRIBUTE = "intakeIssue";
export const RUN_MODE_ATTRIBUTE = "runMode";
export const SOURCE_TYPE_ATTRIBUTE = "sourceType";
export const SOURCE_DELIVERY_ATTRIBUTE = "sourceDeliveryId";

export type AutonomousRunMode = "intake" | "factory" | "ci-fix";

export function stampTrusted(auth: SessionAuthContext): SessionAuthContext {
  return {
    ...auth,
    attributes: { ...auth.attributes, [TRUSTED_ATTRIBUTE]: "true" },
  };
}

export function stampSource(
  auth: SessionAuthContext,
  source: Record<string, string | undefined>,
): SessionAuthContext {
  const attributes = { ...auth.attributes };
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) attributes[key] = value;
  }
  return {
    ...auth,
    attributes,
  };
}

export function stampAutonomous(
  auth: SessionAuthContext,
  intakeIssue: number,
  mode: AutonomousRunMode = "factory",
): SessionAuthContext {
  return {
    ...auth,
    attributes: {
      ...auth.attributes,
      [INTAKE_ISSUE_ATTRIBUTE]: String(intakeIssue),
      [RUN_MODE_ATTRIBUTE]: mode,
    },
    principalId: AUTONOMOUS_PRINCIPAL,
    principalType: "service",
  };
}

export function intakeIssueNumber(auth: SessionAuthContext | null): number | null {
  if (auth === null || !isAutonomous(auth)) return null;
  const value = auth.attributes[INTAKE_ISSUE_ATTRIBUTE];
  if (typeof value !== "string" || value === "") return null;
  const issue = Number(value);
  return Number.isSafeInteger(issue) && issue > 0 ? issue : null;
}

export function autonomousRunMode(auth: SessionAuthContext | null): AutonomousRunMode | null {
  if (auth === null || !isAutonomous(auth)) return null;
  const mode = auth.attributes[RUN_MODE_ATTRIBUTE];
  return mode === "intake" || mode === "factory" || mode === "ci-fix" ? mode : null;
}

export function isAutonomous(auth: SessionAuthContext | null): boolean {
  return auth !== null && auth.principalId === AUTONOMOUS_PRINCIPAL;
}

export function isIntakeRun(auth: SessionAuthContext | null): boolean {
  return autonomousRunMode(auth) === "intake";
}

export function isFactoryRun(auth: SessionAuthContext | null): boolean {
  return autonomousRunMode(auth) === "factory";
}

export function isTrusted(auth: SessionAuthContext | null): boolean {
  return auth !== null && auth.attributes[TRUSTED_ATTRIBUTE] === "true";
}

export function isScheduleAppAuth(auth: SessionAuthContext | null): boolean {
  return (
    auth !== null &&
    auth.authenticator === "app" &&
    auth.principalId === "eve:app" &&
    auth.principalType === "runtime"
  );
}
