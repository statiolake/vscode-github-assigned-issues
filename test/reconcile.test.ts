import assert from "node:assert/strict";
import test from "node:test";
import { reconcileByKey } from "../src/model/reconcile";

test("reconciles updated values without replacing their identity", () => {
  const existing = { id: "1", title: "Old" };
  const added = { id: "2", title: "Added" };
  const result = reconcileByKey(
    [existing],
    [{ id: "1", title: "New" }, added],
    value => value.id,
    (current, next) => { current.title = next.title; }
  );

  assert.equal(result.values[0], existing);
  assert.equal(existing.title, "New");
  assert.equal(result.values[1], added);
  assert.equal(result.structureChanged, true);
});
