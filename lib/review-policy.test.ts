import assert from "node:assert/strict";
import test from "node:test";
import { classifyReviewDepth } from "./review-policy.ts";

test("uses the light path for documentation-only changes", () => {
  const policy = classifyReviewDepth({ changedPaths: ["README.md", "docs/operations.md"], workType: "chore" });
  assert.equal(policy.depth, "light");
  assert.equal(policy.humanEscalation, false);
});

test("uses the standard path for ordinary application changes", () => {
  const policy = classifyReviewDepth({ changedPaths: ["src/widgets/format-date.ts"], workType: "feature", complexity: "small" });
  assert.equal(policy.depth, "standard");
  assert.equal(policy.humanEscalation, false);
});

test("uses the deep path for public API changes", () => {
  const policy = classifyReviewDepth({ changedPaths: ["src/api/users.ts", "src/types/users.d.ts"], workType: "feature" });
  assert.equal(policy.depth, "deep");
  assert.ok(policy.riskFactors.includes("public_api"));
  assert.equal(policy.humanEscalation, true);
});

test("uses the deep path for security and migration signals", () => {
  const policy = classifyReviewDepth({
    affectedSurface: ["agent/lib/approval.ts", "db/migrations/004-permissions.sql"],
    workType: "security",
  });
  assert.equal(policy.depth, "deep");
  assert.ok(policy.riskFactors.includes("security"));
  assert.ok(policy.riskFactors.includes("permissions"));
  assert.ok(policy.riskFactors.includes("migration"));
});

test("a high-risk classifier result overrides documentation paths", () => {
  const policy = classifyReviewDepth({ changedPaths: ["docs/authentication.md"], workType: "security" });
  assert.equal(policy.depth, "deep");
  assert.equal(policy.humanEscalation, true);
});
