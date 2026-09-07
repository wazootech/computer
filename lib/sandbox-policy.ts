/**
 * Deterministic verification policy for Computer's factory capability:
 * the default check commands per repo class, the repair rule, and the
 * time budgets. Pure and dependency-free so the matrix is directly
 * testable, mirroring lib/discord-policy.ts.
 *
 * Source of the defaults: the wazoo-factory decision record, carried
 * through computer#10. The executor runs these inside the pinned
 * Vercel Sandbox session; there is no host-side check path (wspace was
 * deliberately dropped from workspace-cli, see workspace-cli#123).
 */

export interface CheckPhase {
  /** Human-readable phase name for the run record. */
  readonly name: string;
  /** Commands run in order; the phase fails when any command fails. */
  readonly commands: readonly string[];
}

export interface VerificationPolicy {
  readonly phases: readonly CheckPhase[];
  /** Exactly one repair attempt per phase before the phase fails. */
  readonly maxRepairAttempts: number;
  /** Per-command budget in milliseconds. */
  readonly commandTimeoutMs: number;
  /** Per-phase budget in milliseconds (all commands + repair). */
  readonly phaseTimeoutMs: number;
}

/**
 * Default phases for a Node/pnpm repository. Encoded as data so the
 * acceptance command (#13) and the run record quote the same list.
 */
export const DEFAULT_NODE_POLICY: VerificationPolicy = {
  phases: [
    { name: "format", commands: ["pnpm format:check"] },
    { name: "typecheck", commands: ["pnpm typecheck"] },
    { name: "test", commands: ["pnpm test"] },
  ],
  maxRepairAttempts: 1,
  commandTimeoutMs: 300_000,
  phaseTimeoutMs: 600_000,
};

/** Phases flattened to the exact command strings, in run order. */
export function checkCommands(policy: VerificationPolicy = DEFAULT_NODE_POLICY): string[] {
  return policy.phases.flatMap((phase) => [...phase.commands]);
}

/**
 * The sandbox network policy for factory sessions: default-deny with the
 * npm registry allow-listed for dependency installation. github.com is
 * deliberately NOT allow-listed: the publish seam (#7) is host-side, so
 * the sandbox must never need it, and denying it proves credential
 * isolation rather than asserting it.
 */
export const FACTORY_NETWORK_POLICY: { allow: string[] } = {
  allow: ["*.npmjs.org"],
};
