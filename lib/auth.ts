import { betterAuth } from "better-auth";

const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const DEVELOPMENT_ALLOWED_HOSTS = ["localhost:*", "127.0.0.1:*"];

function getAllowedHosts(): string[] {
  if (process.env.NODE_ENV === "development") {
    return DEVELOPMENT_ALLOWED_HOSTS;
  }
  const deploymentHosts = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ].filter((host): host is string => Boolean(host));
  if (deploymentHosts.length === 0) {
    throw new Error("No trusted deployment hosts are configured");
  }
  return Array.from(new Set(deploymentHosts));
}

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === "development") return `development-${name}`;
  throw new Error(`Missing required environment variable: ${name}`);
}

function optionalEnvironmentVariable(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/**
 * GitHub sign-in credentials, when the deployment has them.
 *
 * Linking a GitHub account is what gives a chat session a verified GitHub login:
 * write approvals are attributed to `githubLogin`, and the approval responder
 * check resolves that attribute against the approver-team roster. Without these
 * credentials the deployment signs in exactly as before and approvals from chat
 * report the missing login instead of guessing an identity.
 */
const githubProviderCredentials = ((): { clientId: string; clientSecret: string } | null => {
  const clientId = optionalEnvironmentVariable("GITHUB_OAUTH_CLIENT_ID");
  const clientSecret = optionalEnvironmentVariable("GITHUB_OAUTH_CLIENT_SECRET");
  return clientId && clientSecret ? { clientId, clientSecret } : null;
})();

export const auth = betterAuth({
  baseURL: {
    allowedHosts: getAllowedHosts(),
    protocol: process.env.NODE_ENV === "development" ? "auto" : "https",
  },
  secret: requireEnvironmentVariable("BETTER_AUTH_SECRET"),
  session: {
    expiresIn: SESSION_MAX_AGE_SECONDS,
    disableSessionRefresh: true,
    cookieCache: {
      enabled: true,
      maxAge: SESSION_MAX_AGE_SECONDS,
      refreshCache: false,
      strategy: "jwe",
    },
  },
  socialProviders: {
    vercel: {
      clientId: requireEnvironmentVariable("VERCEL_APP_CLIENT_ID"),
      clientSecret: requireEnvironmentVariable("VERCEL_APP_CLIENT_SECRET"),
    },
    ...(githubProviderCredentials === null ? {} : { github: githubProviderCredentials }),
  },
});
