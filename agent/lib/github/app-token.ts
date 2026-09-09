import { createSign } from "node:crypto";

const API_VERSION = "2022-11-28";

function base64Url(value: string | Uint8Array): string {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function appJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const key = privateKey.replaceAll("\\n", "\n");
  return `${unsigned}.${base64Url(signer.sign(key))}`;
}

export async function mintInstallationToken(): Promise<string> {
  const appId = process.env.GITHUB_APP_ID;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !installationId || !privateKey) {
    throw new Error("GitHub App credentials are incomplete");
  }

  const response = await fetch(
    `https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${appJwt(appId, privateKey)}`,
        "X-GitHub-Api-Version": API_VERSION,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub installation token request returned HTTP ${response.status}`);
  }
  const body = (await response.json()) as { token?: string };
  if (!body.token) throw new Error("GitHub installation token response omitted token");
  return body.token;
}
