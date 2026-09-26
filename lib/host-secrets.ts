import { existsSync, readFileSync } from "node:fs";

/**
 * Names the Discord channel accepts from the host secrets file.
 *
 * An environment variable set on the service definition always wins, so the
 * file is a fallback for credentials that are kept out of the service (and out
 * of this repository) rather than an override of it.
 *
 * `ZO_CLIENT_IDENTITY_TOKEN` is here because the channel calls `/zo/ask` with
 * it: it is the credential Zo already keeps for this host, so the service
 * definition never has to carry a second copy.
 */
export const CHANNEL_SECRET_NAMES = [
  "DISCORD_BOT_TOKEN",
  "ZO_CLIENT_IDENTITY_TOKEN",
  "DISCORD_APPLICATION_ID",
  "DISCORD_INTERNAL_GUILD_IDS",
  "DISCORD_INTERNAL_CHANNEL_IDS",
  "DISCORD_INTERNAL_USER_IDS",
  "DISCORD_INTERNAL_ROLE_IDS",
] as const;

/** Where the host keeps Zo-managed secrets, checked in order. */
export const DEFAULT_HOST_SECRET_PATHS = ["/root/.zo_secrets"] as const;

export interface HostSecretSource {
  /** Path of the file that was read. */
  path: string;
  /** Names that were filled from the file because the environment left them unset. */
  loaded: string[];
  /** True when no file was present, so the environment is used as given. */
  skipped: boolean;
}

/** Parses `KEY=value` lines, ignoring blanks, comments, and `export` prefixes. */
export function parseHostSecrets(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const withoutExport = trimmed.startsWith("export ") ? trimmed.slice(7) : trimmed;
    const separator = withoutExport.indexOf("=");
    if (separator <= 0) continue;
    const name = withoutExport.slice(0, separator).trim();
    let value = withoutExport.slice(separator + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    if (name.length > 0) values.set(name, value);
  }
  return values;
}

/**
 * Fills the channel's credentials from the host's secrets file.
 *
 * Zo services inherit neither the host shell environment nor any deployment's
 * variables, so a bot token kept outside this repository would have to be
 * duplicated into the service definition. Reading the host file instead keeps
 * one copy of each credential. Nothing is overwritten: an unset variable is
 * filled, a set one is left alone.
 */
export function loadHostSecrets(
  env: Record<string, string | undefined> = process.env,
  paths: readonly string[] = DEFAULT_HOST_SECRET_PATHS,
  exists: (path: string) => boolean = existsSync,
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
  names: readonly string[] = CHANNEL_SECRET_NAMES,
): HostSecretSource {
  const override = env.ZO_SECRETS_PATH;
  const candidates = override !== undefined && override.length > 0 ? [override, ...paths] : paths;
  const path = candidates.find((candidate) => exists(candidate));
  if (path === undefined) return { path: candidates[0] ?? "", loaded: [], skipped: true };

  const values = parseHostSecrets(read(path));
  const loaded: string[] = [];
  for (const name of names) {
    const current = env[name];
    if (current !== undefined && current.length > 0) continue;
    const value = values.get(name);
    if (value === undefined || value.length === 0) continue;
    env[name] = value;
    loaded.push(name);
  }
  return { path, loaded, skipped: false };
}
