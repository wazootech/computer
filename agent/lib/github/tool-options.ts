import { buildEveToolDefinition } from "@github-tools/sdk/eve-runtime";
import { defineTool, type ToolDefinition } from "eve/tools";
import type { ApprovalContext, ApprovalStatus } from "eve/tools/approval";
import {
  repositoryScopedSearchQuery,
  type RepositoryTarget,
} from "./repository-target.js";
import { mintInstallationToken } from "./app-token.js";
import {
  closeIssuePolicy,
  commentPolicy,
  createPullRequestPolicy,
  labelPolicy,
  shipPolicy,
  updateIssuePolicy,
  writePolicy,
} from "./approval.js";
import { teamApprovalResponse } from "./team-approval.js";

function baseToolName(toolName: string): string {
  const separator = toolName.lastIndexOf("__");
  return separator === -1 ? toolName : toolName.slice(separator + 2);
}

function githubApprovalRequest(ctx: ApprovalContext): ApprovalStatus {
  switch (baseToolName(ctx.toolName)) {
    case "addAssignees":
    case "addPullRequestComment":
    case "createIssue":
    case "removeAssignees":
    case "requestReviewers":
      return writePolicy(ctx);
    case "addIssueComment":
      return commentPolicy(ctx);
    case "addLabels":
    case "removeLabel":
      return labelPolicy(ctx);
    case "closeIssue":
      return closeIssuePolicy(ctx);
    case "createPullRequest":
      return createPullRequestPolicy(ctx);
    case "updateIssue":
      return updateIssuePolicy(ctx);
    case "updatePullRequest":
      return shipPolicy(ctx);
    default:
      return "not-applicable";
  }
}

export function githubToolOptionsFor(target: RepositoryTarget) {
  return {
    context: { owner: target.owner, repo: target.name },
    token: mintInstallationToken,
  };
}

export function bindGithubTool(toolName: string, target: RepositoryTarget): ToolDefinition {
  const definition = buildEveToolDefinition(
    toolName as never,
    githubToolOptionsFor(target) as never,
  ) as ToolDefinition;
  return defineTool({
    approval: { request: githubApprovalRequest, response: teamApprovalResponse },
    description: definition.description,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    async execute(input, ctx) {
      const boundInput: Record<string, unknown> = {
        ...(input as Record<string, unknown>),
        owner: target.owner,
        repo: target.name,
        repositoryId: target.id,
      };
      if (
        (toolName === "searchCode" || toolName === "searchIssues") &&
        typeof boundInput.query === "string"
      ) {
        boundInput.query = repositoryScopedSearchQuery(boundInput.query, target);
      }
      const runtimeTool = buildEveToolDefinition(
        toolName as never,
        githubToolOptionsFor(target) as never,
      ) as ToolDefinition;
      return runtimeTool.execute(boundInput, ctx);
    },
  });
}
