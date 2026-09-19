import type { Approval, ApprovalContext, ApprovalPolicy, ApprovalStatus } from "eve/tools/approval";
import {
  FACTORY_RUNNING_LABEL,
  FACTORY_STATE_LABELS,
  FACTORY_TERMINAL_LABELS,
  INTAKE_CLASSIFICATION_LABELS,
} from "../constants.js";
import { teamApprovalResponse } from "./team-approval.js";
import {
  intakeIssueNumber,
  isAutonomous,
  isFactoryRun,
  isIntakeRun,
  isScheduleAppAuth,
  isTrusted,
} from "../trust.js";

const denied = (reason: string): ApprovalStatus => ({ reason, type: "denied" });

export function writePolicy(ctx: ApprovalContext): ApprovalStatus {
  const auth = ctx.session.auth.current;
  if (isAutonomous(auth)) {
    return denied("Unattended factory runs may only apply validated intake labels, comment on their intake issue, and open draft pull requests.");
  }
  if (isTrusted(auth) || isScheduleAppAuth(auth)) return "not-applicable";
  return "user-approval";
}

export function commentPolicy(ctx: ApprovalContext): ApprovalStatus {
  const auth = ctx.session.auth.current;
  if (!isAutonomous(auth)) return writePolicy(ctx);
  const intakeIssue = intakeIssueNumber(auth);
  const input = ctx.toolInput as { issueNumber?: unknown } | undefined;
  if (intakeIssue !== null && input?.issueNumber === intakeIssue) return "not-applicable";
  return denied(`Unattended factory runs may comment only on the issue they were dispatched from${intakeIssue === null ? "" : ` (#${intakeIssue})`}.`);
}

export function factoryBrainPolicy(ctx: ApprovalContext): ApprovalStatus {
  const auth = ctx.session.auth.current;
  if (isAutonomous(auth)) return denied("Unattended runs may not write the factory brain.");
  if (isTrusted(auth) || isScheduleAppAuth(auth)) return "not-applicable";
  return "user-approval";
}

function intakeLabelInput(ctx: ApprovalContext): { issueNumber?: unknown; labels?: unknown; label?: unknown } {
  return (ctx.toolInput ?? {}) as { issueNumber?: unknown; labels?: unknown; label?: unknown };
}

export function labelPolicy(ctx: ApprovalContext, boundIssueNumber?: number): ApprovalStatus {
  const auth = ctx.session.auth.current;
  const input = intakeLabelInput(ctx);
  const labels = [
    ...(Array.isArray(input.labels) ? input.labels.filter((label): label is string => typeof label === "string") : []),
    ...(typeof input.label === "string" ? [input.label] : []),
  ];
  if (isFactoryRun(auth)) {
    const intakeIssue = intakeIssueNumber(auth);
    const issueNumber = typeof input.issueNumber === "number" ? input.issueNumber : boundIssueNumber;
    if (issueNumber !== intakeIssue) return denied("Factory runs may change terminal state only on their originating issue.");
    const adding = Array.isArray(input.labels);
    if (adding && labels.length === 1 && FACTORY_TERMINAL_LABELS.includes(labels[0] as (typeof FACTORY_TERMINAL_LABELS)[number])) return "not-applicable";
    if (!adding && labels.length === 1 && labels[0] === FACTORY_RUNNING_LABEL) return "not-applicable";
    return denied("Factory runs may only add one terminal state label or remove factory:running on their originating issue.");
  }
  if (isAutonomous(auth) && labels.some((label) => FACTORY_STATE_LABELS.includes(label as (typeof FACTORY_STATE_LABELS)[number]))) {
    return denied("Factory state labels can only be changed by the intake state transition tool.");
  }
  if (!isIntakeRun(auth)) return isAutonomous(auth) ? "not-applicable" : writePolicy(ctx);
  const intakeIssue = intakeIssueNumber(auth);
  if (input.issueNumber !== intakeIssue) return denied("Intake may label only its originating issue.");
  if (labels.some((label) => FACTORY_STATE_LABELS.includes(label as (typeof FACTORY_STATE_LABELS)[number]))) {
    return denied("Use set_intake_state for factory state transitions.");
  }
  if (labels.some((label) => !INTAKE_CLASSIFICATION_LABELS.includes(label as (typeof INTAKE_CLASSIFICATION_LABELS)[number]))) {
    return denied("Intake may apply only the configured classification labels.");
  }
  return "not-applicable";
}

export function shipPolicy(ctx: ApprovalContext): ApprovalStatus {
  if (isAutonomous(ctx.session.auth.current)) return denied("Unattended runs stop at a draft pull request.");
  return "user-approval";
}

export function closeIssuePolicy(ctx?: ApprovalContext): ApprovalStatus {
  if (ctx && isIntakeRun(ctx.session.auth.current)) return denied("Intake cannot close or reopen issues.");
  return "not-applicable";
}

export function createPullRequestPolicy(ctx: ApprovalContext): ApprovalStatus {
  if (isIntakeRun(ctx.session.auth.current)) return denied("Intake cannot create pull requests.");
  const input = ctx.toolInput as { draft?: unknown } | undefined;
  return input?.draft === true ? "not-applicable" : shipPolicy(ctx);
}

export function updateIssuePolicy(ctx: ApprovalContext): ApprovalStatus {
  if (isIntakeRun(ctx.session.auth.current)) return denied("Intake cannot update issue state directly.");
  const input = ctx.toolInput as { state?: unknown } | undefined;
  return input?.state !== undefined ? closeIssuePolicy(ctx) : writePolicy(ctx);
}

export function teamApproval(request: ApprovalPolicy): Approval {
  return { request, response: teamApprovalResponse };
}
