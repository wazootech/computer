import { createSign } from "node:crypto";

import {
  GATEWAY_BASE_URL,
  modelProviderOptions,
  resolveDeepSeekThinking,
  resolveGatewayCredential,
  resolveGatewayModel,
} from "./gateway.ts";
import { validateFactoryLabelConfiguration } from "../agent/lib/constants.ts";
import {
  defaultSessionRepository,
  parseRepositoryFullName,
  resolveInstallationRepository,
} from "../agent/lib/github/session-attachment.ts";

const GITHUB_API_VERSION = "2022-11-28";

type Environment = Record<string, string | undefined>;
type Fetch = typeof fetch;

export type SecretStatus = Record<string, boolean>;

export type AcceptanceTargetValidation = {
  ok: boolean;
  errors: string[];
};

export type AcceptanceTarget = {
  repository: string;
  issueNumber: number;
  baseSha: string;
  worktree: string;
  disposable: boolean;
};

export function validateAcceptanceTarget(target: AcceptanceTarget): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!/^[^/\s]+\/[^/\s]+$/u.test(target.repository)) errors.push("repository must be owner/name");
  if (!Number.isSafeInteger(target.issueNumber) || target.issueNumber <= 0) errors.push("issueNumber must be positive");
  if (!/^[0-9a-f]{40}$/iu.test(target.baseSha)) errors.push("baseSha must be a full commit SHA");
  if (!target.worktree.trim()) errors.push("worktree is required");
  if (!target.disposable) errors.push("target must be explicitly disposable");
  return { errors, ok: errors.length === 0 };
}

export type PreflightResult = {
  ok: boolean;
  secrets: SecretStatus;
  githubApp: {
    ok: boolean;
    appId: string | null;
    installationId: string | null;
    membersPermission: string | null;
    permissions: Record<string, string>;
    team: string;
    memberCount: number | null;
    /** Installation coverage for the repository this session would work on. */
    repository: {
      fullName: string;
      ok: boolean;
      id: number | null;
      error?: string;
    };
    error?: string;
  };
  model: {
    ok: boolean;
    skipped?: boolean;
    id: string;
    status: number | null;
    error?: string;
  };
  factoryLabels: {
    ok: boolean;
    errors: string[];
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

function requiredSecrets(env: Environment, includeModel: boolean): SecretStatus {
  const names = [
    "GITHUB_APP_ID",
    "GITHUB_APP_INSTALLATION_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "FACTORY_APPROVAL_SECRET",
  ];
  const status = Object.fromEntries(names.map((name) => [name, Boolean(env[name]?.trim())]));
  // One logical gateway credential: either accepted variable satisfies it, so
  // an OIDC-only deployment does not read as a missing secret.
  if (includeModel) status.GATEWAY_CREDENTIAL = resolveGatewayCredential(env) !== null;
  return status;
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

async function checkGatewayModel(
  env: Environment,
  fetchImpl: Fetch,
): Promise<PreflightResult["model"]> {
  const model = resolveGatewayModel(env);
  const credential = resolveGatewayCredential(env);
  if (credential === null) {
    return {
      ok: false,
      id: model,
      status: null,
      error: "AI_GATEWAY_API_KEY and VERCEL_OIDC_TOKEN are both missing",
    };
  }

  try {
    const response = await fetchImpl(`${GATEWAY_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential.value}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with exactly OK." }],
        max_tokens: 4,
        temperature: 0,
        // Mirror the agent wiring (agent/lib/models.ts) so preflight proves
        // the exact request shape the agent will send, including the
        // thinking-mode pin, without which the provider default (thinking
        // ON) would make preflight validate a different behavior.
        ...modelProviderOptions(resolveDeepSeekThinking(env)).providerOptions,
      }),
    });
    if (!response.ok) {
      return {
        ok: false,
        id: model,
        status: response.status,
        // 401/403 are the two credential-path failures worth naming: an
        // unusable key versus a gateway account that cannot reach this model.
        error: resolveGatewayFailure(response.status),
      };
    }
    const body = (await response.json()) as { choices?: unknown[] };
    if (!Array.isArray(body.choices) || body.choices.length === 0) {
      return { ok: false, id: model, status: response.status, error: "gateway response omitted choices" };
    }
    return { ok: true, id: model, status: response.status };
  } catch {
    return {
      ok: false,
      id: model,
      status: null,
      error: "gateway request failed before receiving a response",
    };
  }
}

/**
 * Names the two credential-path failures a gateway call can hit, so a broken
 * agent reports which one it is instead of a bare status code.
 */
export function resolveGatewayFailure(status: number): string {
  if (status === 401) {
    return "gateway rejected the credential (HTTP 401): the gateway key or OIDC token is invalid";
  }
  if (status === 403) {
    return "gateway refused this model for the account (HTTP 403): the model requires purchased AI Gateway credits";
  }
  return `gateway request returned HTTP ${status}`;
}

export async function runPreflight(
  env: Environment = process.env,
  fetchImpl: Fetch = fetch,
  options: { checkModel?: boolean; org?: string; team?: string; repository?: string } = {},
): Promise<PreflightResult> {
  const checkModelEnabled = options.checkModel ?? true;
  const secrets = requiredSecrets(env, checkModelEnabled);
  const requestedRepository = options.repository?.trim() || defaultSessionRepository(env);
  const repositoryFullName = parseRepositoryFullName(requestedRepository);
  const repository: PreflightResult["githubApp"]["repository"] = {
    fullName: repositoryFullName ?? requestedRepository,
    ok: false,
    id: null,
  };
  if (repositoryFullName === null) {
    repository.error = `invalid-format: ${requestedRepository} is not an owner/name repository`;
  }
  const githubApp: PreflightResult["githubApp"] = {
    ok: false,
    appId: env.GITHUB_APP_ID ?? null,
    installationId: env.GITHUB_APP_INSTALLATION_ID ?? null,
    membersPermission: null,
    permissions: {},
    team: `${options.org ?? "wazootech"}/${options.team ?? "team"}`,
    memberCount: null,
    repository,
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
      githubApp.permissions = installation.permissions;
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
      }
      if (repositoryFullName === null) {
        githubApp.error ??= repository.error;
      } else {
        const resolution = await resolveInstallationRepository({
          fullName: repositoryFullName,
          token: installation.token,
          fetchImpl,
        });
        if (resolution.ok) {
          repository.ok = true;
          repository.id = resolution.target.id;
        } else {
          repository.error = resolution.failure;
        }
      }
      githubApp.ok = githubApp.error === undefined && repository.ok;
    } catch (error) {
      githubApp.error = error instanceof Error ? error.message : "GitHub preflight failed";
    }
  }

  const model = checkModelEnabled
    ? await checkGatewayModel(env, fetchImpl)
    : {
        ok: true,
        skipped: true,
        id: resolveGatewayModel(env),
        status: null,
      };
  const factoryLabelErrors = validateFactoryLabelConfiguration(env);
  const factoryLabels = { errors: factoryLabelErrors, ok: factoryLabelErrors.length === 0 };
  const ok = githubApp.ok && model.ok && factoryLabels.ok && missingSecrets(secrets).length === 0;
  return { ok, secrets, githubApp, model, factoryLabels };
}

export function summarizeSecrets(
  env: Environment = process.env,
  includeModel = true,
): SecretStatus {
  return requiredSecrets(env, includeModel);
}

export async function mintInstallationToken(): Promise<string> {
  return (await readInstallationToken(process.env, fetch)).token;
}
