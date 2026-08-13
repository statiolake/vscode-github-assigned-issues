import assert from "node:assert/strict";
import test from "node:test";
import { isFresh } from "../src/model/cachePolicy";

const snapshot = { savedAt: 1_000_000 };

test("reuses snapshots within the automatic refresh interval", () => {
  assert.equal(isFresh(snapshot, 5, 1_299_999), true);
  assert.equal(isFresh(snapshot, 5, 1_300_000), false);
  assert.equal(isFresh(snapshot, 0, 1_000_000), false);
});
