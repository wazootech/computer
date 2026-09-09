import { buildEveToolDefinition } from "@github-tools/sdk/eve-runtime";
import { githubToolOptions } from "#lib/github/tool-options.js";

export default buildEveToolDefinition("getIssueContext", githubToolOptions);
