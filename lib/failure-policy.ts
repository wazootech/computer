/**
 * Failure-comment policy for Computer's chat channels.
 *
 * eve's built-in channel handlers post `details.name` plus the raw failed-event
 * message. For a model-provider rejection that message is the upstream
 * provider's own words, which is how a revoked key put
 * "Model provider API error: Authentication Fails, Your api key: ****53a6…"
 * into the originating thread on every dispatch (#77).
 *
 * Two rules follow from that:
 *
 * - A **deployment fault** — an unusable credential, an unpaid gateway
 *   account, or a model this account cannot reach — is not a reply to the
 *   person who asked. Only an operator can clear it, so the channel stays
 *   silent and the evidence goes to the runtime log instead of the thread.
 * - **No failure comment carries provider text.** Every other failure gets one
 *   short reply, with the correlation id when the event has one, so a support
 *   request can still be traced back to one incident.
 *
 * The provider's own message is never interpolated anywhere in this module, so
 * neither the comment nor the log line can leak a credential.
 */

export type FailureEvent = {
  readonly code: string;
  readonly details?: Record<string, unknown> | undefined;
  readonly message: string;
};

/** `details.name` values eve sets when the model call was rejected upstream. */
const PROVIDER_REJECTION_NAMES = new Set([
  "AI Gateway model request rejected",
  "Model provider API error",
]);

/** Gateway `upstreamType` values that no retry can clear. */
const TERMINAL_UPSTREAM_TYPES = new Set([
  "authentication_error",
  "invalid_request_error",
  "model_not_found",
]);

/** HTTP statuses that name the deployment, not the request, as the fault. */
const DEPLOYMENT_STATUS_CODES = new Set([401, 402, 403]);

/** Matches the rejection name when a cascade carries it only in `message`. */
const PROVIDER_REJECTION_PATTERN = /\b(?:AI Gateway model request rejected|Model provider API error)\b/u;

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/**
 * Reads the correlation id eve attaches to a failed event, so a support ticket
 * quoting the id can be grepped back to one incident.
 */
export function failureErrorId(details: unknown): string | undefined {
  if (typeof details !== "object" || details === null) return undefined;
  return readString((details as { errorId?: unknown }).errorId);
}

/**
 * True when the failure is a deployment fault that only an operator can clear.
 *
 * Signals are checked in specificity order: the structured rejection name, the
 * gateway's own terminal `upstreamType`, the status code, then the name inside
 * `message` for older cascades that predate `details.name`.
 */
export function isDeploymentFault(failure: FailureEvent): boolean {
  const details = failure.details ?? {};
  const name = readString(details.name);
  if (name !== undefined && PROVIDER_REJECTION_NAMES.has(name)) return true;
  const upstreamType = readString(details.upstreamType);
  if (upstreamType !== undefined && TERMINAL_UPSTREAM_TYPES.has(upstreamType)) return true;
  const statusCode = readNumber(details.statusCode);
  if (statusCode !== undefined && DEPLOYMENT_STATUS_CODES.has(statusCode)) return true;
  return name === undefined && PROVIDER_REJECTION_PATTERN.test(failure.message);
}

/**
 * The comment a channel posts for a failed turn or session, or `null` when the
 * channel should stay silent because only an operator can clear the failure.
 */
export function failureCommentBody(failure: FailureEvent): string | null {
  if (isDeploymentFault(failure)) return null;
  const id = failureErrorId(failure.details);
  return [
    "I hit an error while handling that request and could not recover.",
    "",
    "Please try again or rephrase it.",
    ...(id === undefined ? [] : ["", `Error id: ${id}`]),
  ].join("\n");
}

/**
 * A one-line summary for the runtime log, built from structured fields only.
 * The provider's message is deliberately absent: the point of logging here is
 * that the thread stays quiet, not that the text moves somewhere else.
 */
export function describeFailure(failure: FailureEvent): string {
  const details = failure.details ?? {};
  const parts = [failure.code];
  const name = readString(details.name);
  if (name !== undefined) parts.push(name);
  const upstreamType = readString(details.upstreamType);
  if (upstreamType !== undefined) parts.push(`upstream ${upstreamType}`);
  const statusCode = readNumber(details.statusCode);
  if (statusCode !== undefined) parts.push(`HTTP ${statusCode}`);
  const id = failureErrorId(details);
  if (id !== undefined) parts.push(`error id ${id}`);
  return parts.join(" | ");
}
