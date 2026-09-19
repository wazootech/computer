import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { FACTORY_CANDIDATE_LABEL, WAYFINDER_TASK_LABEL } from "#lib/constants.js";
import { appendRunHistoryEvent, claimIntakeDecision } from "#lib/run-history.js";
import { mintInstallationToken } from "#lib/github/app-token.js";
import { repositoryTargetFromAuth } from "#lib/github/repository-target.js";
import {
  isAllowedIntakeClassificationLabel,
  intakeStateForLabels,
  labelForIntakeState,
  planIntakeStateTransition,
  stateLabelsForTransition,
  type IntakeState,
} from "#lib/intake-policy.js";
import { intakeIssueNumber, isIntakeRun } from "#lib/trust.js";

const githubApiVersion = "2022-11-28";
type IssueResponse = { labels?: Array<{ name?: unknown }> };

async function githubFetch(target: { owner: string; name: string }, path: string, init: RequestInit = {}) {
  const token = await mintInstallationToken();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-GitHub-Api-Version", githubApiVersion);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(`https://api.github.com/repos/${target.owner}/${target.name}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) throw new Error(`GitHub intake state request failed with HTTP ${response.status}`);
  return response;
}

async function readIssue(target: { owner: string; name: string }, issueNumber: number): Promise<Set<string>> {
  const response = await githubFetch(target, `/issues/${issueNumber}`);
  const body = (await response.json()) as IssueResponse;
  return new Set((body.labels ?? []).flatMap((label) => typeof label.name === "string" ? [label.name] : []));
}

async function addLabels(target: { owner: string; name: string }, issueNumber: number, labels: string[]) {
  if (labels.length === 0) return;
  await githubFetch(target, `/issues/${issueNumber}/labels`, {
    method: "POST",
    body: JSON.stringify({ labels }),
  });
}

async function removeLabel(target: { owner: string; name: string }, issueNumber: number, label: string) {
  await githubFetch(target, `/issues/${issueNumber}/labels/${encodeURIComponent(label)}`, { method: "DELETE" });
}

const tool = defineTool({
  description: "Record a validated intake classification and transition the originating issue to queued, needs_clarification, duplicate, or blocked. This is the only tool that may change factory intake state.",
  inputSchema: z.object({
    classificationLabels: z.array(z.string()).max(4).default([]),
    duplicateOf: z.number().int().positive().optional(),
    questions: z.array(z.string().min(1).max(500)).max(8).default([]),
    state: z.enum(["blocked", "duplicate", "needs_clarification", "queued"]),
    summary: z.string().min(1).max(2_000),
  }),
  outputSchema: z.object({ issueNumber: z.number(), labels: z.array(z.string()), state: z.string(), duplicate: z.boolean() }),
  async execute(input, ctx) {
    const auth = ctx.session.auth.current;
    if (auth === null || !isIntakeRun(auth)) throw new Error("set_intake_state is available only during candidate intake.");
    const issueNumber = intakeIssueNumber(auth);
    const deliveryId = typeof auth.attributes.intakeDeliveryId === "string" ? auth.attributes.intakeDeliveryId : undefined;
    const target = repositoryTargetFromAuth(ctx.session.auth);
    if (!target || issueNumber === null) throw new Error("The intake session has no verified issue target.");
    if (input.state === "duplicate" && input.duplicateOf === undefined) throw new Error("A duplicate decision must name the canonical issue.");
    if (input.state === "needs_clarification" && input.questions.length === 0) throw new Error("A clarification decision must include questions.");
    if (input.state === "queued" && input.questions.length > 0) throw new Error("A queued decision cannot include clarification questions.");
    if (input.classificationLabels.some((label) => !isAllowedIntakeClassificationLabel(label))) {
      throw new Error("The classification contains a label outside the configured repository vocabulary.");
    }
    const labels = await readIssue(target, issueNumber);
    const decisionClaim = await claimIntakeDecision(target, ctx.session.id, { issueNumber, state: input.state });
    const currentState = intakeStateForLabels([...labels]);
    let plan: { duplicate: boolean; add: string[]; remove: string[] };
    if (currentState === null && decisionClaim.duplicate && decisionClaim.state === input.state) {
      if (!labels.has(FACTORY_CANDIDATE_LABEL) && !labels.has(WAYFINDER_TASK_LABEL)) {
        throw new Error("The claimed intake decision cannot be reconciled without a valid candidate or task label.");
      }
      const fallback = stateLabelsForTransition([...labels], input.state as IntakeState);
      plan = { duplicate: false, ...fallback };
    } else {
      plan = planIntakeStateTransition([...labels], input.state as IntakeState, labels.has(WAYFINDER_TASK_LABEL));
    }
    const plannedEvent = {
      data: {
        applied: false,
        classificationLabels: input.classificationLabels,
        duplicateOf: input.duplicateOf,
        questions: input.questions,
        state: input.state,
      },
      idempotencyKey: `intake-decision:${deliveryId ?? ctx.session.id}:${input.state}:planned`,
      kind: "intake.decision" as const,
      runId: ctx.session.id,
      source: {
        channel: "github",
        deliveryId,
        issueNumber,
        type: "intake",
      },
      status: input.state === "queued" ? "waiting" as const : input.state === "needs_clarification" ? "waiting" as const : "manual" as const,
      summary: input.summary,
    };
    await appendRunHistoryEvent(plannedEvent, target);
    if (plan.duplicate) {
      await appendRunHistoryEvent({ ...plannedEvent, data: { ...plannedEvent.data, applied: true }, idempotencyKey: `intake-decision:${deliveryId ?? ctx.session.id}:${input.state}:applied` }, target);
      return { duplicate: true, issueNumber, labels: [...labels].sort(), state: input.state };
    }
    await addLabels(target, issueNumber, [...input.classificationLabels, ...plan.add]);
    for (const label of plan.remove) await removeLabel(target, issueNumber, label);
    const after = await readIssue(target, issueNumber);
    if (intakeStateForLabels([...after]) !== input.state) throw new Error("Intake state transition could not be confirmed; retry the decision.");
    await appendRunHistoryEvent({ ...plannedEvent, data: { ...plannedEvent.data, applied: true }, idempotencyKey: `intake-decision:${deliveryId ?? ctx.session.id}:${input.state}:applied` }, target);
    return { duplicate: false, issueNumber, labels: [...after].sort(), state: input.state };
  },
});

export default defineDynamic({
  events: {
    "session.started": (_event, ctx) => isIntakeRun(ctx.session.auth.current) ? tool : null,
    "turn.started": (_event, ctx) => isIntakeRun(ctx.session.auth.current) ? tool : null,
  },
});
