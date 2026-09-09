const redactText = (text: string): string => text
  .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gu, "[REDACTED_PEM]")
  .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/giu, "$1[REDACTED]")
  .replace(/\b(?:ghp|gho|ghu|ghs|ghr|github_pat|sk|xoxb|xoxp)-[A-Za-z0-9_-]+\b/gu, "[REDACTED_TOKEN]")
  .replace(/\b(GITHUB_APP_PRIVATE_KEY|GITHUB_WEBHOOK_SECRET|DEEPSEEK_API_KEY|FACTORY_APPROVAL_SECRET)\s*[:=]\s*[^\s,;]+/gu, (_, name: string) => `${name}=[REDACTED]`);

export function redact(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      /token|secret|password|private.?key|authorization|api.?key/i.test(key) ? "[REDACTED]" : redact(entry),
    ]));
  }
  return value;
}

export function redactString(value: string): string {
  return redactText(value);
}
