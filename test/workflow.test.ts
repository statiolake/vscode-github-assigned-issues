import assert from "node:assert/strict";
import test from "node:test";
import { isVisibleInLane, laneForStatus, validateProjectConfigs } from "../src/model/workflow";
import { ProjectConfig } from "../src/model/types";

const config: ProjectConfig = {
  owner: "octo-org",
  ownerType: "organization",
  number: 1,
  statuses: {
    todo: ["Backlog", "Todo"],
    inProgress: ["Doing"],
    inReview: ["Review"]
  }
};

test("maps project-specific status names to canonical lanes", () => {
  assert.equal(laneForStatus(config, "backlog"), "todo");
  assert.equal(laneForStatus(config, "DOING"), "inProgress");
  assert.equal(laneForStatus(config, "Review"), "inReview");
  assert.equal(laneForStatus(config, "Done"), undefined);
});

test("shows assigned and unassigned issues according to the lane policy", () => {
  assert.equal(isVisibleInLane("todo", [], "statiolake"), true);
  assert.equal(isVisibleInLane("todo", ["other"], "statiolake"), false);
  assert.equal(isVisibleInLane("inProgress", [], "statiolake"), false);
  assert.equal(isVisibleInLane("inProgress", ["statiolake"], "statiolake"), true);
  assert.equal(isVisibleInLane("inReview", [], "statiolake"), true);
});

test("rejects ambiguous status mappings", () => {
  const invalid = {
    ...config,
    statuses: { ...config.statuses, inReview: ["Todo"] }
  };
  assert.match(validateProjectConfigs([invalid]).join("\n"), /mapped to both/);
});
