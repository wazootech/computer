import { defineDynamic } from "eve/tools";
import { bindGithubTool } from "#lib/github/tool-options.js";
import { repositoryTargetFromAuth } from "#lib/github/repository-target.js";

export default defineDynamic({
  events: {
    "session.started": (_event, ctx) => {
      const target = repositoryTargetFromAuth(ctx.session.auth);
      return target ? bindGithubTool("compareCommits", target) : null;
    },
    "turn.started": (_event, ctx) => {
      const target = repositoryTargetFromAuth(ctx.session.auth);
      return target ? bindGithubTool("compareCommits", target) : null;
    },
  },
});
