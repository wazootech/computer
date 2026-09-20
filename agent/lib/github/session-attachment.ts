import type { SessionAuthContext } from "eve/context";

import { repositoryAttributes, type RepositoryTarget } from "./repository-target.ts";

/**
 * Attaches a verified GitHub repository to a session that was not started by a
 * GitHub event.
 *
 * The GitHub channel stamps its event's repository on the session auth; sessions
 * opened from the web chat or the eve HTTP API had no such stamp, so every
 * `github__*` tool stayed unbound and the agent could not use GitHub at all.
 * Here the eve channel resolves a repository at request time and stamps the same
 * `githubRepository*` attributes, so the shared readers
 * (`repositoryTargetFromAuth`, the dynamic tool binders) pick up a target
 * without any change.
 *
 * Two properties matter:
 *
 * - Coverage is proven, not assumed. The name is resolved through the
 *   installation token, so an app that cannot see the repository fails the
 *   resolve instead of binding tools that would 404 later.
 * - Only human principals are attached. App/runtime principals (eval and
 *   schedule runs) are left untouched, because their write approvals are
 *   `not-applicable` and attaching a repository would hand unattended runs a
 *   GitHub write surface they do not have today.
 *
 * The module is dependency-injected on purpose: the token mint lives in
 * `app-token.ts` and the caller (the eve channel) supplies the resolver, so this
 * file stays loadable and testable without the deployment's GitHub credentials.
 */

export const SESSION_REPOSITORY_HEADER = "x-computer-repository";

/** The federation manifest repo: it lists every repository in the org. */
export const DEFAULT_SESSION_REPOSITORY = "wazootech/workspace";

export const REPOSITORY_FAILURE_ATTRIBUTE = "githubRepositoryError";
export const REPOSITORY_FAILURE_NAME_ATTRIBUTE = "githubRepositoryErrorName";

export type SessionRepositoryFailure =
  | "credentials-incomplete"
  | "invalid-format"
  | "not-covered"
  | "not-authorized"
  | "api-error";

export type SessionRepositoryResolution =
  | { ok: true; target: RepositoryTarget }
  | { ok: false; failure: SessionRepositoryFailure };

export type SessionRepositoryResolver = (fullName: string) => Promise<SessionRepositoryResolution>;

const FULL_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9]?)\/([A-Za-z0-9._-]+)$/;

type Environment = Record<string, string | undefined>;

/** Parses `owner/name`, rejecting anything else (including whitespace or URLs). */
export function parseRepositoryFullName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 140) return null;
  return FULL_NAME_PATTERN.test(trimmed) ? trimmed : null;
}

export function defaultSessionRepository(env: Environment = process.env): string {
  return parseRepositoryFullName(env.COMPUTER_SESSION_REPOSITORY) ?? DEFAULT_SESSION_REPOSITORY;
}

/** The repository a request asks for: an explicit header, else the deployment default. */
export function requestedSessionRepository(
  request: Request,
  env: Environment = process.env,
): { ok: true; fullName: string } | { ok: false; failure: "invalid-format" } {
  const header = request.headers.get(SESSION_REPOSITORY_HEADER);
  if (header === null) return { ok: true, fullName: defaultSessionRepository(env) };
  const fullName = parseRepositoryFullName(header);
  if (fullName === null) return { ok: false, failure: "invalid-format" };
  return { ok: true, fullName };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Resolves one repository through the installation token.
 *
 * `GET /repos/{owner}/{name}` succeeds only when the installation can reach the
 * repository, so a successful call is the coverage proof. GitHub answers 404 for
 * both "no such repository" and "not covered by this installation"; both mean the
 * same thing here.
 */
export async function resolveInstallationRepository(input: {
  fullName: string;
  token: string;
  fetchImpl: typeof fetch;
}): Promise<SessionRepositoryResolution> {
  let response: Response;
  try {
    response = await input.fetchImpl(
      `https://api.github.com/repos/${input.fullName.split("/").map(encodeURIComponent).join("/")}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${input.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
  } catch {
    return { ok: false, failure: "api-error" };
  }

  if (response.status === 404) return { ok: false, failure: "not-covered" };
  if (response.status === 401 || response.status === 403) return { ok: false, failure: "not-authorized" };
  if (!response.ok) return { ok: false, failure: "api-error" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, failure: "api-error" };
  }
  if (!isRecord(body) || !isRecord(body.owner)) return { ok: false, failure: "api-error" };

  const id = body.id;
  const name = body.name;
  const owner = body.owner.login;
  const fullName = body.full_name;
  if (
    typeof id !== "number" ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    typeof name !== "string" ||
    typeof owner !== "string" ||
    typeof fullName !== "string"
  ) {
    return { ok: false, failure: "api-error" };
  }

  return { ok: true, target: { fullName, id, name, owner } };
}

/**
 * Memoizes repository resolution per name.
 *
 * The eve channel resolves on every authenticated request, and each resolve
 * costs an installation-token mint plus a GitHub call. A short TTL keeps that off
 * the request path while still noticing an installation that loses access.
 */
export function createSessionRepositoryResolver(input: {
  fetchImpl: typeof fetch;
  mintToken: () => Promise<string>;
  now?: () => number;
  ttlMs?: number;
  cacheLimit?: number;
}): SessionRepositoryResolver {
  const now = input.now ?? Date.now;
  const ttlMs = input.ttlMs ?? 600_000;
  const cacheLimit = input.cacheLimit ?? 32;
  const cache = new Map<string, { expiresAt: number; resolution: SessionRepositoryResolution }>();
  const inFlight = new Map<string, Promise<SessionRepositoryResolution>>();

  function remember(fullName: string, resolution: SessionRepositoryResolution) {
    if (cache.size >= cacheLimit) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(fullName, { expiresAt: now() + ttlMs, resolution });
  }

  return async (fullName: string) => {
    const cached = cache.get(fullName);
    if (cached && cached.expiresAt > now()) return cached.resolution;

    const pending = inFlight.get(fullName);
    if (pending) return pending;

    const resolve = (async () => {
      let token: string;
      try {
        token = await input.mintToken();
      } catch {
        return { ok: false, failure: "credentials-incomplete" } as SessionRepositoryResolution;
      }
      const resolution = await resolveInstallationRepository({
        fullName,
        token,
        fetchImpl: input.fetchImpl,
      });
      // Only successful resolutions are cached: a repository that is not covered
      // yet may be added to the installation, and the next request should see it.
      if (resolution.ok) remember(fullName, resolution);
      return resolution;
    })();

    inFlight.set(fullName, resolve);
    try {
      return await resolve;
    } finally {
      inFlight.delete(fullName);
    }
  };
}

/** Whether this principal is a human session the attachment applies to. */
export function isInteractivePrincipal(auth: SessionAuthContext | null): auth is SessionAuthContext {
  return auth !== null && auth.principalType === "user";
}

export type SessionAttachmentOutcome =
  | { attached: true; auth: SessionAuthContext; target: RepositoryTarget }
  | {
      attached: false;
      auth: SessionAuthContext | null;
      failure: SessionRepositoryFailure | null;
      fullName: string | null;
    };

/**
 * Stamps a verified repository on the session auth, or records why it could not.
 *
 * A failure never blocks the turn: the session still runs, the GitHub tools stay
 * unbound, and the failing reason is stamped so the channel can say which piece
 * is missing instead of the agent reporting a generic "no repository attached".
 */
export async function attachSessionRepository(
  auth: SessionAuthContext | null,
  request: Request,
  deps: { resolve: SessionRepositoryResolver; env?: Environment },
): Promise<SessionAttachmentOutcome> {
  if (!isInteractivePrincipal(auth)) return { attached: false, auth, failure: null, fullName: null };

  const requested = requestedSessionRepository(request, deps.env ?? process.env);
  if (!requested.ok) {
    return {
      attached: false,
      auth: withFailure(auth, requested.failure, null),
      failure: requested.failure,
      fullName: null,
    };
  }

  const resolution = await deps.resolve(requested.fullName);
  if (!resolution.ok) {
    return {
      attached: false,
      auth: withFailure(auth, resolution.failure, requested.fullName),
      failure: resolution.failure,
      fullName: requested.fullName,
    };
  }

  return {
    attached: true,
    auth: { ...auth, attributes: { ...auth.attributes, ...repositoryAttributes(resolution.target) } },
    target: resolution.target,
  };
}

function withFailure(
  auth: SessionAuthContext,
  failure: SessionRepositoryFailure,
  fullName: string | null,
): SessionAuthContext {
  return {
    ...auth,
    attributes: {
      ...auth.attributes,
      [REPOSITORY_FAILURE_ATTRIBUTE]: failure,
      ...(fullName === null ? {} : { [REPOSITORY_FAILURE_NAME_ATTRIBUTE]: fullName }),
    },
  };
}

const KNOWN_FAILURES: readonly SessionRepositoryFailure[] = [
  "credentials-incomplete",
  "invalid-format",
  "not-covered",
  "not-authorized",
  "api-error",
];

/** Reads the stamped failure, for the channel's context line and preflight. */
export function sessionRepositoryFailure(
  auth: SessionAuthContext | null,
): { failure: SessionRepositoryFailure; fullName: string | null } | null {
  const attributes = auth?.attributes;
  const failure = attributes?.[REPOSITORY_FAILURE_ATTRIBUTE];
  if (typeof failure !== "string" || !KNOWN_FAILURES.includes(failure as SessionRepositoryFailure)) return null;
  const fullName = attributes?.[REPOSITORY_FAILURE_NAME_ATTRIBUTE];
  return {
    failure: failure as SessionRepositoryFailure,
    fullName: typeof fullName === "string" ? fullName : null,
  };
}

export const REPOSITORY_FAILURE_REASONS: Record<SessionRepositoryFailure, string> = {
  "credentials-incomplete":
    "the deployment is missing complete GitHub App credentials (GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY)",
  "invalid-format": `the requested repository is not in owner/name form (set ${SESSION_REPOSITORY_HEADER} to a plain owner/name value)`,
  "not-covered": "the GitHub App installation does not cover that repository",
  "not-authorized": "the GitHub App installation token was rejected for that repository",
  "api-error": "the GitHub API could not be reached",
};

/** One model-visible sentence explaining a missing attachment, or null when attached. */
export function sessionRepositoryNotice(
  auth: SessionAuthContext | null,
  env: Environment = process.env,
): string | null {
  const failure = sessionRepositoryFailure(auth);
  if (failure === null) return null;
  const subject =
    failure.fullName === null
      ? "no repository is attached to this session"
      : `\`${failure.fullName}\` could not be attached`;
  const fallback = defaultSessionRepository(env);
  return `GitHub: ${subject} because ${REPOSITORY_FAILURE_REASONS[failure.failure]}. The \`github__*\` tools are unavailable until a repository is attached; say which piece is missing instead of retrying, and start a session with a repository (owner/name) to attach one — the default is \`${fallback}\`.`;
}
