import { test } from "node:test";
import assert from "node:assert/strict";
import { assignReveals, splitAroundDetail, TREE_REVEAL_CAP, TREE_REVEAL_LEAD_MS, TREE_REVEAL_STAGGER_MS } from "../src/lib/tree-reveal.ts";

test("rows present on the first pass never animate", () => {
  const known = new Map<string, number | null>();
  assignReveals(known, ["a", "b"], false);
  assert.deepEqual([...known], [["a", null], ["b", null]]);
});

test("live arrivals reveal after the lead and stagger when they come together", () => {
  const known = new Map<string, number | null>();
  assignReveals(known, ["a"], false);
  assignReveals(known, ["a", "b"], true);
  assert.equal(known.get("b"), TREE_REVEAL_LEAD_MS);
  assignReveals(known, ["a", "b", "c", "d"], true);
  assert.equal(known.get("c"), TREE_REVEAL_LEAD_MS);
  assert.equal(known.get("d"), TREE_REVEAL_LEAD_MS + TREE_REVEAL_STAGGER_MS);
  assert.equal(known.get("a"), null, "a loaded row stays still");
  assert.equal(known.get("b"), TREE_REVEAL_LEAD_MS, "a known row keeps its value");
});

test("a finished turn never reveals and a burst's delay is capped", () => {
  const known = new Map<string, number | null>();
  assignReveals(known, ["x"], false);
  assignReveals(known, ["x", "y"], false);
  assert.equal(known.get("y"), null);
  const ids = Array.from({ length: 20 }, (_, index) => `r${index}`);
  assignReveals(known, ids, true);
  assert.equal(known.get("r19"), TREE_REVEAL_LEAD_MS + TREE_REVEAL_CAP * TREE_REVEAL_STAGGER_MS);
});

test("a sentence splits around its command or path", () => {
  assert.deepEqual(splitAroundDetail("Ran npm test", "npm test"), ["Ran ", "npm test", ""]);
  assert.deepEqual(splitAroundDetail("Running src/a.ts…", "src/a.ts"), ["Running ", "src/a.ts", "…"]);
  assert.deepEqual(splitAroundDetail("Ran a command", ""), ["Ran a command", "", ""]);
  assert.deepEqual(splitAroundDetail("Ran a command", "missing"), ["Ran a command", "", ""]);
});
