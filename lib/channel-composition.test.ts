import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const channelSource = readFileSync(
  new URL("../agent/channels/eve.ts", import.meta.url),
  "utf8",
);

const authArray = (() => {
  const match = /auth:\s*\[([\s\S]*?)\],/.exec(channelSource);
  assert.ok(match, "the Eve channel declares an auth array");
  return match[1];
})();

test("stamps the approver login outside the repository attachment", () => {
  assert.match(
    authArray.replace(/\s+/g, " "),
    /withApproverLogin\(withRepository\(betterAuthSession\)\)/,
    "withApproverLogin must wrap withRepository, not the reverse: the attachment step returns its own authorization, so an inner stamp would be dropped and every chat approval would fail again",
  );
});

test("keeps the repository attachment on every auth path", () => {
  assert.equal(
    authArray.split("withRepository(").length - 1,
    3,
    "all three auth functions are attached: the signed-in session, the Vercel OIDC principal, and local dev",
  );
});

test("keeps the repository notice on the message path", () => {
  assert.match(channelSource, /async onMessage\(ctx\)/);
  assert.match(channelSource, /sessionRepositoryNotice\(caller\)/);
});
