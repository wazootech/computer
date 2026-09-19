import { defineEval } from "eve/evals";

export default defineEval({
  description:
    "The pipeline selects deep review for security and permission changes before implementation and keeps the implementer idle when asked to stop.",
  tags: ["slow", "needs-connect"],
  async test(t) {
    await t.send(
      "Work item: tighten authorization for the public API and add a permission migration. Classify and analyze this work, assess the review depth, then stop before implementation and report the policy."
    );
    t.succeeded();
    t.calledSubagent("classifier");
    t.calledSubagent("analyst");
    t.calledTool("assess_review_depth");
    t.calledSubagent("implementer", { count: 0 });
  },
});
