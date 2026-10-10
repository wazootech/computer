import assert from "node:assert/strict";
import test from "node:test";
import { prSummaryAutorreplyEnabled } from "./pr-summary-policy.ts";

test("stays quiet when the switch is unset", () => {
  assert.equal(prSummaryAutorreplyEnabled({}), false);
});

test("stays quiet for every value that is not exactly on", () => {
  for (const value of ["", " ", "off", "false", "0", "no", "enabled", "on?"]) {
    assert.equal(
      prSummaryAutorreplyEnabled({ COMPUTER_PR_SUMMARY_AUTOREPLY: value }),
      false,
      `"${value}" must not enable the unattended summary`,
    );
  }
});

test("posts only when the switch is on", () => {
  assert.equal(prSummaryAutorreplyEnabled({ COMPUTER_PR_SUMMARY_AUTOREPLY: "on" }), true);
  assert.equal(prSummaryAutorreplyEnabled({ COMPUTER_PR_SUMMARY_AUTOREPLY: " ON " }), true);
});
