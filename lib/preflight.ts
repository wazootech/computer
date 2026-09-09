import { createSign } from "node:crypto";

const GITHUB_API_VERSION = "2022-11-28";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

type Environment = Record<string, string | undefined>;
type Fetch = typeof fetch;

export type SecretStatus = Record<string, boolean>;

export type PreflightResult = {
  ok: boolean;
  secrets: SecretStatus;
  githubApp: {
    ok: boolean;
    appId: string | null;
    installationId: string | null;
    membersPermission: string | null;
    team: string;
    memberCount: number | null;
    error?: string;
  };
  deepSeek: {
    ok: boolean;
    skipped?: boolean;
    model: string;
    status: number | null;
    error?: string;
  };
};

function base64Url(value: string | Uint8Array): string {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function createAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${base64Url(signer.sign(privateKey.replaceAll("\\n", "\n")))}`;
}

function requiredSecrets(env: Environment, includeDeepSeek: boolean): SecretStatus {
  const names = [
    "GITHUB_APP_ID",
    "GITHUB_APP_INSTALLATION_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "FACTORY_APPROVAL_SECRET",
  ];
  if (includeDeepSeek) names.push("DEEPSEEK_API_KEY");
  return Object.fromEntries(names.map((name) => [name, Boolean(env[name]?.trim())]));
}

function missingSecrets(status: SecretStatus): string[] {
  return Object.entries(status)
    .filter(([, present]) => !present)
    .map(([name]) => name);
}

function nextLink(response: Response): string | null {
  const link = response.headers.get("link");
  const match = link?.match(/<([^>]+)>;\s*rel="next"/u);
  return match?.[1] ?? null;
}

async function readInstallationToken(
  env: Environment,
  fetchImpl: Fetch,
): Promise<{ token: string; permissions: Record<string, string> }> {
  const appId = env.GITHUB_APP_ID;
  const installationId = env.GITHUB_APP_INSTALLATION_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !installationId || !privateKey) {
    throw new Error("GitHub App credentials are incomplete");
  }

  const response = await fetchImpl(
    `https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${createAppJwt(appId, privateKey)}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`installation token request returned HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    token?: string;
    permissions?: Record<string, string>;
  };
  if (!body.token) throw new Error("installation token response omitted token");
  return { token: body.token, permissions: body.permissions ?? {} };
}

async function readTeamMemberCount(
  token: string,
  org: string,
  team: string,
  fetchImpl: Fetch,
): Promise<number> {
  let nextUrl: string | null =
    `https://api.github.com/orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(team)}/members?per_page=100`;
  let count = 0;
  while (nextUrl) {
    const response = await fetchImpl(nextUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
    });
    if (!response.ok) {
      throw new Error(`team membership request returned HTTP ${response.status}`);
    }
    const members = (await response.json()) as unknown[];
    count += members.length;
    nextUrl = nextLink(response);
  }
  return count;
}

async function checkDeepSeek(
  env: Environment,
  fetchImpl: Fetch,
): Promise<PreflightResult["deepSeek"]> {
  const model = env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL;
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey?.trim()) {
    return { ok: false, model, status: null, error: "DEEPSEEK_API_KEY is missing" };
  }

  const baseUrl = env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_DEEPSEEK_BASE_URL;
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/u, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with exactly OK." }],
        max_tokens: 4,
        temperature: 0,
      }),
    });
    if (!response.ok) {
      return {
        ok: false,
        model,
        status: response.status,
        error: `DeepSeek request returned HTTP ${response.status}`,
      };
    }
    const body = (await response.json()) as { choices?: unknown[] };
    if (!Array.isArray(body.choices) || body.choices.length === 0) {
      return { ok: false, model, status: response.status, error: "DeepSeek response omitted choices" };
    }
    return { ok: true, model, status: response.status };
  } catch {
    return {
      ok: false,
      model,
      status: null,
      error: "DeepSeek request failed before receiving a response",
    };
  }
}

export async function runPreflight(
  env: Environment = process.env,
  fetchImpl: Fetch = fetch,
  options: { checkDeepSeek?: boolean; org?: string; team?: string } = {},
): Promise<PreflightResult> {
  const checkDeepSeekEnabled = options.checkDeepSeek ?? true;
  const secrets = requiredSecrets(env, checkDeepSeekEnabled);
  const githubApp: PreflightResult["githubApp"] = {
    ok: false,
    appId: env.GITHUB_APP_ID ?? null,
    installationId: env.GITHUB_APP_INSTALLATION_ID ?? null,
    membersPermission: null,
    team: `${options.org ?? "wazootech"}/${options.team ?? "team"}`,
    memberCount: null,
  };

  const githubMissing = missingSecrets(
    Object.fromEntries(
      Object.entries(secrets).filter(([name]) => name.startsWith("GITHUB_")),
    ),
  );
  if (githubMissing.length > 0) {
    githubApp.error = `missing ${githubMissing.join(", ")}`;
  } else {
    try {
      const installation = await readInstallationToken(env, fetchImpl);
      githubApp.membersPermission = installation.permissions.members ?? null;
      if (githubApp.membersPermission !== "read") {
        githubApp.error = `installation token has members permission ${githubApp.membersPermission ?? "none"}, expected read`;
      } else {
        githubApp.memberCount = await readTeamMemberCount(
          installation.token,
          options.org ?? "wazootech",
          options.team ?? "team",
          fetchImpl,
        );
        githubApp.ok = true;
      }
    } catch (error) {
      githubApp.error = error instanceof Error ? error.message : "GitHub preflight failed";
    }
  }

  const deepSeek = checkDeepSeekEnabled
    ? await checkDeepSeek(env, fetchImpl)
    : {
        ok: true,
        skipped: true,
        model: env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL,
        status: null,
      };
  const ok = githubApp.ok && deepSeek.ok && missingSecrets(secrets).length === 0;
  return { ok, secrets, githubApp, deepSeek };
}

export function summarizeSecrets(
  env: Environment = process.env,
  includeDeepSeek = true,
): SecretStatus {
  return requiredSecrets(env, includeDeepSeek);
}

export async function mintInstallationToken(): Promise<string> {
  return (await readInstallationToken(process.env, fetch)).token;
}
