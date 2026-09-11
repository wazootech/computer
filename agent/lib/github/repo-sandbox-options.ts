import type { VercelSandboxCreateOptions } from "eve/sandbox/vercel";

export const FACTORY_SANDBOX_CREATE_OPTIONS = {
  resources: { vcpus: 4 },
} satisfies VercelSandboxCreateOptions;
