/**
 * Autorreply policy for the unattended pull-request summary comment.
 *
 * The summary comment is the one thing the GitHub channel posts without being
 * asked. `onPullRequest` dispatched it for every pull request opened by an
 * allowlisted team member, in every covered repository, so a branch anyone
 * pushed cost a full model session and a comment nobody requested. Measured on
 * 2026-10-10 across `wazootech/workspace`, `wazoo-api`, and `memory`: two
 * identical comments per pull request, minutes after it opened.
 *
 * The behavior is therefore opt-in. `COMPUTER_PR_SUMMARY_AUTOREPLY=on` restores
 * it; anything else, including unset, leaves the channel quiet. Mention-driven
 * invocations are unaffected: they answer a person who asked.
 */

/** Environment variable that turns the unattended pull-request summary back on. */
export const PR_SUMMARY_AUTOREPLY_ENV = "COMPUTER_PR_SUMMARY_AUTOREPLY";

/**
 * Whether an opened pull request receives the summary comment with no mention.
 *
 * Off unless the variable is exactly `on`, so a typo or a stray value keeps the
 * channel quiet rather than re-enabling the comment.
 */
export function prSummaryAutorreplyEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[PR_SUMMARY_AUTOREPLY_ENV]?.trim().toLowerCase() === "on";
}
