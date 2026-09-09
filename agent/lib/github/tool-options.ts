import type { EveGithubToolsOptions } from "@github-tools/sdk/eve-runtime";
import { factoryRepo } from "../constants.js";
import {
  closeIssuePolicy,
  commentPolicy,
  createPullRequestPolicy,
  labelPolicy,
  shipPolicy,
  updateIssuePolicy,
  writePolicy,
  teamApproval,
} from "./approval.js";
import { mintInstallationToken } from "./app-token.js";

export const githubToolOptions: EveGithubToolsOptions = {
  context: factoryRepo,
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
