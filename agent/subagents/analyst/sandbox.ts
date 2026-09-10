import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";
import { FACTORY_SANDBOX_CREATE_OPTIONS, factoryOnSession } from "../../lib/github/repo-sandbox.js";

export default defineSandbox({
  backend: vercel(FACTORY_SANDBOX_CREATE_OPTIONS),
  onSession: factoryOnSession,
});
