/**
 * Parsers for the Zo Computer MCP tools the bridge deploy uses.
 *
 * `scripts/zo-deploy.ts` drives the live bridge through Zo's MCP endpoint, whose
 * tool results arrive as text. The three shapes it has to read are a bash
 * `CmdResult`, the `list_user_services` repr, and the `service_doctor` report.
 * Each one is parsed here so the fragile part stays pure and covered by tests.
 */

/** One bash tool result, as `bash` renders it. */
export interface ZoCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly returncode: number;
}

/** One entry of `list_user_services`, reduced to the fields a deploy needs. */
export interface ZoServiceEntry {
  readonly serviceId: string;
  readonly label: string;
  readonly mode: string;
  readonly entrypoint: string;
  readonly workdir: string;
}

/** The slice of `service_doctor` that tells a deploy whether the restart took. */
export interface ZoServiceStatus {
  readonly label: string;
  readonly state: string;
  readonly uptimeSeconds: number | null;
  readonly logs: string;
}

const COMMAND_RESULT_PATTERN = /^CmdResult\(stdout='([\s\S]*?)', stderr='([\s\S]*?)', returncode=(-?\d+)\)$/u;
const SERVICE_ENTRY_PATTERN = /service_id='([^']*)' label='([^']*)' mode='([^']*)'/u;
const SERVICE_FIELD_ESCAPED = String.raw`(?:[^'\\]|\\.)*`;
const REPR_ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", "\\": "\\", "'": "'", '"': '"' };

/** Reads a bash result. Returns null when the text is not a command result. */
export function parseZoCommandResult(text: string): ZoCommandResult | null {
  const match = COMMAND_RESULT_PATTERN.exec(text.trim());
  if (match === null) return null;
  const [, stdout, stderr, returncode] = match;
  return { stdout: unescapeRepr(stdout), stderr: unescapeRepr(stderr), returncode: Number(returncode) };
}

/**
 * Reads the `list_user_services` repr into entries, skipping unparsable lines.
 *
 * One entry spans several lines: the `- service_id=...` line carries the label,
 * mode, and entrypoint, and the same record's continuation lines carry the
 * workdir and domain fields. Fields are read from the whole record so
 * continuation-only fields are not lost.
 */
export function parseZoServiceList(text: string): readonly ZoServiceEntry[] {
  const entries: ZoServiceEntry[] = [];
  let record: string | null = null;
  const flush = (): void => {
    if (record === null) return;
    const head = SERVICE_ENTRY_PATTERN.exec(record);
    if (head !== null) {
      entries.push({
        serviceId: head[1],
        label: head[2],
        mode: head[3],
        entrypoint: readEscapedField(record, "entrypoint"),
        workdir: readEscapedField(record, "workdir"),
      });
    }
    record = null;
  };
  for (const line of text.split("\n")) {
    if (SERVICE_ENTRY_PATTERN.test(line)) {
      flush();
      record = line;
      continue;
    }
    if (record === null) continue;
    if (line.trim() === "") {
      flush();
      continue;
    }
    record += `\n${line}`;
  }
  flush();
  return entries;
}

/** Finds one service by label. Duplicate labels are a misconfiguration, not a pick. */
export function findZoService(entries: readonly ZoServiceEntry[], label: string): ZoServiceEntry | null {
  const matches = entries.filter((entry) => entry.label === label);
  return matches.length === 1 ? matches[0] : null;
}

/** Reads one service's line and log tail out of a `service_doctor` report. */
export function parseZoServiceStatus(text: string, label: string): ZoServiceStatus | null {
  const line = text.split("\n").find((candidate) => candidate.trim().startsWith(`${label}:`));
  if (line === undefined) return null;
  const status = line.trim().slice(label.length + 1).trim();
  const uptime = /uptime (\d+):(\d+):(\d+)/u.exec(status);
  return {
    label,
    state: status.split(",")[0].trim(),
    uptimeSeconds: uptime === null ? null : Number(uptime[1]) * 3_600 + Number(uptime[2]) * 60 + Number(uptime[3]),
    logs: readDoctorLogs(text),
  };
}

/** Pulls the `Logs (...)` section out of a `service_doctor` report. */
function readDoctorLogs(text: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim().startsWith("Logs ("));
  if (start === -1) return "";
  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") {
      if (collected.length > 0) break;
      continue;
    }
    collected.push(line.trim());
  }
  return collected.join("\n");
}

/** Reads one `key='...'` field, honoring Python-repr backslash escapes. */
function readEscapedField(line: string, key: string): string {
  const pattern = new RegExp(String.raw`${key}='(${SERVICE_FIELD_ESCAPED})'`, "u");
  const match = pattern.exec(line);
  return match === null ? "" : unescapeRepr(match[1]);
}

/** Turns repr escapes back into the characters they stand for. */
function unescapeRepr(value: string): string {
  return value.replaceAll(/\\(.)/gu, (_match, char: string) => REPR_ESCAPES[char] ?? char);
}
