import assert from "node:assert/strict";
import test from "node:test";
import { parseGitHubRemote } from "../src/git/remote";

test("parses HTTPS and SSH GitHub remotes", () => {
  assert.deepEqual(parseGitHubRemote("https://github.com/statiolake/example.git"), {
    owner: "statiolake",
    name: "example"
  });
  assert.deepEqual(parseGitHubRemote("git@github.com:statiolake/example.git"), {
    owner: "statiolake",
    name: "example"
  });
});
