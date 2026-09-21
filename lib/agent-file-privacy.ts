/**
 * Fail-closed privacy and integrity checks for the exported Agent File.
 *
 * A published `.af` is a declaration, not a transcript. This module enforces
 * that claim instead of asserting it: every non-empty block value must trace to
 * a `shareable: true` declaration and match it byte for byte, the message
 * surface must be empty, credentials must be absent, and no exported string may
 * carry a secret-shaped payload.
 *
 * Fail-closed means an unrecognized block label is an error, not a silent skip.
 * If someone adds a block to the declaration file without deciding its
 * shareability, the export stops until they decide.
 */

import type { AgentFile } from "./agent-file-schema.ts";
import type { AgentFileDeclaration } from "./agent-file-project.ts";

export type PrivacyFinding = { rule: string; detail: string };

type SecretRule = { rule: string; pattern: RegExp };

/**
 * Patterns that identify a credential or a personal path rather than prose.
 * Environment variable *names* are deliberately not matched: the system prompt
 * legitimately names variables like `GITHUB_APP_PRIVATE_KEY` without carrying
 * a value, and a name is not a secret.
 */
const SECRET_RULES: SecretRule[] = [
  { rule: "private-key-block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u },
  { rule: "openai-style-key", pattern: /\bsk-[A-Za-z0-9_-]{16,}/u },
  { rule: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})/u },
  { rule: "slack-token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/u },
  { rule: "aws-access-key-id", pattern: /\bAKIA[0-9A-Z]{12,}/u },
  { rule: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./u },
  { rule: "long-hex-secret", pattern: /\b[0-9a-f]{32,}\b/u },
  { rule: "email-address", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/u },
  { rule: "personal-home-path", pattern: /\/(?:home|Users)\/[A-Za-z0-9._-]+\/users\//u },
  { rule: "private-key-file", pattern: /\.pem\b|\.p12\b|id_rsa/u },
];

function walkStrings(value: unknown, path: string, visit: (text: string, path: string) => void): void {
  if (typeof value === "string") {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkStrings(entry, `${path}[${index}]`, visit));
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) walkStrings(entry, `${path}.${key}`, visit);
  }
}

export function checkAgentFilePrivacy(file: AgentFile, declaration: AgentFileDeclaration): PrivacyFinding[] {
  const findings: PrivacyFinding[] = [];
  const declared = new Map(declaration.blocks.map((block) => [block.label, block]));

  for (const block of file.blocks) {
    const entry = declared.get(block.label);
    if (entry === undefined) {
      findings.push({
        rule: "block-not-declared",
        detail: `block ${block.label} is in the export but has no declaration, so its shareability is undecided`,
      });
      continue;
    }
    const hasValue = block.value.length > 0;
    if (hasValue && !entry.shareable) {
      findings.push({
        rule: "private-block-value-exported",
        detail: `block ${block.label} carries ${block.value.length} characters but is declared private`,
      });
      continue;
    }
    if (hasValue && entry.value !== block.value) {
      findings.push({
        rule: "block-value-not-from-declaration",
        detail: `block ${block.label} does not match its declared value, so it did not come from the declaration`,
      });
    }
    if (!hasValue && entry.shareable) {
      findings.push({
        rule: "shareable-block-empty",
        detail: `block ${block.label} is declared shareable but exported empty`,
      });
    }
    if (!hasValue && entry.privateBecause === null) {
      findings.push({
        rule: "private-block-unjustified",
        detail: `block ${block.label} is private without a recorded reason`,
      });
    }
  }

  for (const agent of file.agents) {
    if (agent.messages.length > 0) {
      findings.push({ rule: "messages-not-empty", detail: `${agent.messages.length} conversation messages exported` });
    }
    if (agent.in_context_message_ids.length > 0) {
      findings.push({
        rule: "in-context-messages-not-empty",
        detail: `${agent.in_context_message_ids.length} in-context message ids exported`,
      });
    }
    for (const [field, value] of [
      ["secrets", agent.secrets],
      ["tool_exec_environment_variables", agent.tool_exec_environment_variables],
    ] as const) {
      const keys = Object.keys(value);
      if (keys.length > 0) {
        findings.push({
          rule: "credentials-present",
          detail: `${field} carries ${keys.length} entr(ies); exports must carry none`,
        });
      }
    }
  }

  walkStrings(file, "agent_file", (text, path) => {
    for (const { rule, pattern } of SECRET_RULES) {
      if (pattern.test(text)) {
        findings.push({ rule, detail: `${path} matches a secret-shaped pattern` });
      }
    }
  });

  return findings;
}

/**
 * Integrity of the projection itself: the exported prompt must be the compiled
 * prompt, byte for byte. A truncated or reworded prompt would silently produce
 * a file that describes an agent nobody runs.
 */
export function checkProjectionIntegrity(file: AgentFile, instructions: string): PrivacyFinding[] {
  const findings: PrivacyFinding[] = [];
  for (const agent of file.agents) {
    if (agent.system !== instructions) {
      findings.push({
        rule: "system-prompt-drift",
        detail: `agent.system is ${agent.system.length} characters, the compiled instructions are ${instructions.length}`,
      });
    }
  }
  if (file.created_at !== null) {
    findings.push({ rule: "unstable-timestamp", detail: "created_at must stay null so regeneration is byte-stable" });
  }
  return findings;
}
