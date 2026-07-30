import assert from "node:assert/strict";
import test from "node:test";
import { parseClosingPullRequestReferences } from "../src/github/pullRequests";

const repository = {
  owner: "statiolake",
  name: "example",
  defaultBranch: "main",
  cloneUrl: "https://github.com/statiolake/example.git"
};

test("extracts local and cross-repository closing references", () => {
  assert.deepEqual(
    parseClosingPullRequestReferences(
      "Fixes #12\nCloses another/repo#34\nresolved #56",
      repository
    ),
    [
      { owner: "statiolake", repository: "example", number: 12 },
      { owner: "another", repository: "repo", number: 34 },
      { owner: "statiolake", repository: "example", number: 56 }
    ]
  );
});
