import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";
import { FACTORY_NETWORK_POLICY } from "../lib/sandbox-policy";

/**
 * Computer's sandbox: the Vercel backend pinned unconditionally so local
 * development exercises the same hosted backend as production (the
 * wazoo-factory choice, carried through computer#10).
 *
 * Network policy is default-deny with only the npm registry allow-listed.
 * github.com is deliberately unreachable from the sandbox: the publish
 * seam (computer#7) is host-side, so no credential ever needs to enter
 * the sandbox and denying the domain proves the isolation rule.
 *
 * The session timeout bounds one factory phase chain; durable state
 * carries the run across step boundaries regardless (SandboxState).
 */
export default defineSandbox({
  backend: vercel(),
  async onSession({ use }) {
    await use({
      networkPolicy: FACTORY_NETWORK_POLICY,
      resources: { vcpus: 4 },
      timeout: 3_600_000,
    });
  },
});
