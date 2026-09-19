import { defineHook } from "eve/hooks";
import { sourceFromAuth, hasGithubCorrelation } from "#lib/run-history-source.js";
import { appendRunHistoryEvent } from "#lib/run-history.js";
import { repositoryTargetFromAuth } from "#lib/github/repository-target.js";

const EVENT_MAP: Record<string, { kind: Parameters<typeof appendRunHistoryEvent>[0]["kind"]; status?: Parameters<typeof appendRunHistoryEvent>[0]["status"] }> = {
  "session.started": { kind: "run.started", status: "running" },
  "session.waiting": { kind: "run.waiting", status: "waiting" },
  "session.completed": { kind: "run.completed", status: "completed" },
  "session.failed": { kind: "run.failed", status: "failed" },
  "turn.started": { kind: "turn.started" },
  "turn.completed": { kind: "turn.completed" },
  "turn.failed": { kind: "turn.failed", status: "failed" },
  "turn.cancelled": { kind: "turn.cancelled", status: "cancelled" },
  "subagent.called": { kind: "stage.started" },
  "subagent.completed": { kind: "stage.completed" },
  "action.result": { kind: "action.completed" },
  "input.requested": { kind: "approval.requested", status: "waiting" },
  "input.resolved": { kind: "approval.resolved" },
};

type RuntimeEvent = {
  meta?: { id?: string; at?: string };
  type: string;
  data?: Record<string, unknown>;
};

function summaryFor(event: RuntimeEvent): string {
  const data = event.data ?? {};
  const name = typeof data.name === "string" ? data.name : typeof data.subagentName === "string" ? data.subagentName : undefined;
  const childSessionId = typeof data.childSessionId === "string" ? data.childSessionId : undefined;
  if (name && childSessionId) return `${event.type}: ${name} (${childSessionId})`;
  if (name) return `${event.type}: ${name}`;
  return event.type;
}

export default defineHook({
  events: {
    "session.started": async (event, ctx) => record(event, ctx),
    "session.waiting": async (event, ctx) => record(event, ctx),
    "session.completed": async (event, ctx) => record(event, ctx),
    "session.failed": async (event, ctx) => record(event, ctx),
    "turn.started": async (event, ctx) => record(event, ctx),
    "turn.completed": async (event, ctx) => record(event, ctx),
    "turn.failed": async (event, ctx) => record(event, ctx),
    "turn.cancelled": async (event, ctx) => record(event, ctx),
    "subagent.called": async (event, ctx) => record(event, ctx),
    "subagent.completed": async (event, ctx) => record(event, ctx),
    "action.result": async (event, ctx) => record(event, ctx),
    "input.requested": async (event, ctx) => record(event, ctx),
    "input.resolved": async (event, ctx) => record(event, ctx),
  },
});

async function record(event: RuntimeEvent, ctx: { session: { id: string; auth: unknown }; channel: { kind?: string } }) {
  const target = repositoryTargetFromAuth(ctx.session.auth as never);
  if (!target) return;
  const mapped = EVENT_MAP[event.type];
  if (!mapped) return;
  const source = sourceFromAuth(ctx.session.auth, ctx.channel.kind);
  if (!hasGithubCorrelation(source)) {
    console.error("run history correlation incomplete for GitHub session", {
      event: source.event,
      issueNumber: source.issueNumber,
      pullRequestNumber: source.pullRequestNumber,
      type: source.type,
    });
  }
  const data = event.data ?? {};
  const childRunId = typeof data.childSessionId === "string" ? data.childSessionId : undefined;
  try {
    await appendRunHistoryEvent({
      childRunId,
      data: {
        childRunId,
        name: typeof data.name === "string" ? data.name : undefined,
        subagentName: typeof data.subagentName === "string" ? data.subagentName : undefined,
        toolName: typeof data.toolName === "string" ? data.toolName : undefined,
      },
      idempotencyKey: event.meta?.id ?? `${ctx.session.id}:${event.type}:${event.meta?.at ?? "unknown"}`,
      kind: mapped.kind,
      occurredAt: event.meta?.at,
      parentRunId: childRunId ? ctx.session.id : undefined,
      runId: ctx.session.id,
      source,
      stage: typeof data.name === "string" ? data.name : typeof data.subagentName === "string" ? data.subagentName : undefined,
      status: mapped.status,
      summary: summaryFor(event),
    }, target);
  } catch (error) {
    console.error("run history event persistence failed", error instanceof Error ? error.message : "unknown error");
  }
}
