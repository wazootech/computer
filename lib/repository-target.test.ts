import assert from "node:assert/strict";
import test from "node:test";
import {
  repositoryScopedSearchQuery,
  repositoryScopeKey,
  repositoryTargetFromAuth,
  type RepositoryTarget,
} from "../agent/lib/github/repository-target.ts";

const target: RepositoryTarget = {
  fullName: "wazootech/example",
  id: 42,
  name: "example",
  owner: "wazootech",
};

test("repository target comes only from stamped session auth", () => {
  assert.deepEqual(
    repositoryTargetFromAuth({
      attributes: {
        githubRepositoryFullName: target.fullName,
        githubRepositoryId: String(target.id),
        githubRepositoryName: target.name,
        githubRepositoryOwner: target.owner,
      },
    } as never),
    target
  );
  assert.equal(repositoryTargetFromAuth({ attributes: {} } as never), null);
});

test("repository scope includes the stable GitHub repository id", () => {
  assert.notEqual(
    repositoryScopeKey(target),
    repositoryScopeKey({ ...target, id: 43 })
  );
});

test("repository-scopes global search queries and overrides model repo qualifiers", () => {
  assert.equal(
    repositoryScopedSearchQuery("bug repo:other/private is:open", target),
    "repo:wazootech/example bug is:open"
  );
  assert.equal(
    repositoryScopedSearchQuery("repo:other/private", target),
    "repo:wazootech/example"
  );
});
