import { buildEveToolDefinition } from "@github-tools/sdk/eve-runtime";
import { defineTool, type ToolDefinition } from "eve/tools";
import type { RepositoryTarget } from "./repository-target.js";
import {
  closeIssuePolicy,
  commentPolicy,
  createPullRequestPolicy,
  labelPolicy,
  shipPolicy,
  teamApproval,
  updateIssuePolicy,
  writePolicy,
} from "./approval.js";
import { mintInstallationToken } from "./app-token.js";

export function githubToolOptionsFor(target: RepositoryTarget) {
  return {
    context: { owner: target.owner, repo: target.name },
    requireApproval: {
      addAssignees: teamApproval(writePolicy),
      addIssueComment: teamApproval(commentPolicy),
      addLabels: teamApproval(labelPolicy),
      addPullRequestComment: teamApproval(writePolicy),
      closeIssue: teamApproval(closeIssuePolicy),
      createIssue: teamApproval(writePolicy),
      createPullRequest: teamApproval(createPullRequestPolicy),
      removeAssignees: teamApproval(writePolicy),
      removeLabel: teamApproval(labelPolicy),
      requestReviewers: teamApproval(writePolicy),
      updateIssue: teamApproval(updateIssuePolicy),
      updatePullRequest: teamApproval(shipPolicy),
    },
    token: mintInstallationToken,
  };
}

export function bindGithubTool(toolName: string, target: RepositoryTarget): ToolDefinition {
  const inner = buildEveToolDefinition(toolName as never, githubToolOptionsFor(target) as never) as ToolDefinition;
  return defineTool({
    approval: inner.approval,
    description: inner.description,
    inputSchema: inner.inputSchema,
    outputSchema: inner.outputSchema,
    async execute(input, ctx) {
      return inner.execute(
        {
          ...(input as Record<string, unknown>),
          owner: target.owner,
          repo: target.name,
          repositoryId: target.id,
        },
        ctx
      );
    },
  });
}
