import assert from "node:assert/strict";
import test from "node:test";
import { activeLeaf, edgeAt, initialSplit, splitDrop, splitDropState, splitLeaves, splitRects, splitRemove, splitResize, splitSync, SPLIT_MAX_PANES, type SplitLayout } from "../src/lib/split-layout.ts";

const ids = (layout: SplitLayout) => splitLeaves(layout.root).map((leaf) => leaf.sessionId);

test("dropping on an edge opens a new active pane on that side", () => {
  const start = initialSplit("a");
  const right = splitDrop(start, "b", { target: start.activeLeafId, edge: "right" });
  assert.deepEqual(ids(right), ["a", "b"]);
  assert.equal(activeLeaf(right).sessionId, "b");
  assert.equal(right.root.type === "split" && right.root.dir, "row");
  const above = splitDrop(right, "c", { target: right.activeLeafId, edge: "top" });
  assert.deepEqual(ids(above), ["a", "c", "b"]);
  const whole = splitDrop(above, "d", { target: "root", edge: "bottom" });
  assert.equal(whole.root.type === "split" && whole.root.dir, "column");
  assert.deepEqual(ids(whole), ["a", "c", "b", "d"]);
});

test("the pane limit refuses new panes but still allows replacing", () => {
  let layout = initialSplit("s0");
  for (let index = 1; index < SPLIT_MAX_PANES; index++) layout = splitDrop(layout, `s${index}`, { target: layout.activeLeafId, edge: "right" });
  assert.equal(splitLeaves(layout.root).length, SPLIT_MAX_PANES);
  assert.equal(splitDropState(layout, "new", { target: layout.activeLeafId, edge: "left" }), "full");
  assert.equal(splitDrop(layout, "new", { target: layout.activeLeafId, edge: "left" }), layout);
  const replaced = splitDrop(layout, "new", { target: layout.activeLeafId, edge: "center" });
  assert.equal(activeLeaf(replaced).sessionId, "new");
});

test("an open conversation moves or swaps instead of duplicating", () => {
  const two = splitDrop(initialSplit("a"), "b", { target: initialSplit().activeLeafId, edge: "right" });
  // The target above does not exist, so nothing changed.
  assert.equal(splitLeaves(two.root).length, 1);
  const start = initialSplit("a");
  const pair = splitDrop(start, "b", { target: start.activeLeafId, edge: "right" });
  const [left, right] = splitLeaves(pair.root);
  assert.equal(splitDropState(pair, "b", { target: right.id, edge: "left" }), "none");
  const swapped = splitDrop(pair, "b", { target: left.id, edge: "center" });
  assert.deepEqual(ids(swapped), ["b", "a"]);
  const moved = splitDrop(pair, "b", { target: left.id, edge: "top" });
  assert.deepEqual(ids(moved), ["b", "a"]);
  assert.equal(moved.root.type === "split" && moved.root.dir, "column");
  assert.equal(splitLeaves(moved.root).find((leaf) => leaf.sessionId === "b")?.id, right.id, "a moved pane keeps its identity");
});

test("closing the active pane activates the pane that takes its space", () => {
  const start = initialSplit("a");
  const pair = splitDrop(start, "b", { target: start.activeLeafId, edge: "right" });
  const closed = splitRemove(pair, pair.activeLeafId);
  assert.deepEqual(ids(closed), ["a"]);
  assert.equal(activeLeaf(closed).sessionId, "a");
  assert.equal(splitRemove(closed, closed.activeLeafId), closed, "the last pane stays");
});

test("selection sync activates a shown session, else retargets the active pane, and prunes deleted sessions", () => {
  const start = initialSplit("a");
  const pair = splitDrop(start, "b", { target: start.activeLeafId, edge: "right" });
  const live = new Set(["a", "b", "c"]);
  const toA = splitSync(pair, "a", live);
  assert.equal(activeLeaf(toA).sessionId, "a");
  assert.deepEqual(ids(toA), ["a", "b"]);
  const toC = splitSync(toA, "c", live);
  assert.deepEqual(ids(toC), ["c", "b"]);
  assert.equal(splitSync(toC, "c", live), toC, "no change keeps identity");
  const pruned = splitSync(toC, "c", new Set(["c"]));
  assert.deepEqual(ids(pruned), ["c"]);
  const landing = splitSync(toC, null, live);
  assert.deepEqual(ids(landing), [null, "b"]);
});

test("rects, resize bounds and edge detection", () => {
  const start = initialSplit("a");
  const pair = splitDrop(start, "b", { target: start.activeLeafId, edge: "right" });
  const branch = pair.root.type === "split" ? pair.root : null;
  assert.ok(branch);
  const resized = splitResize(pair, branch.id, 0.95);
  assert.equal(resized.root.type === "split" && resized.root.ratio, 0.8);
  const { panes, dividers } = splitRects(resized.root);
  const [left, right] = splitLeaves(resized.root);
  assert.deepEqual(panes.get(left.id), { x: 0, y: 0, w: 0.8, h: 1 });
  assert.equal(panes.get(right.id)?.x, 0.8);
  assert.equal(dividers.length, 1);
  assert.equal(edgeAt(0.5, 0.5), "center");
  assert.equal(edgeAt(0.9, 0.5), "right");
  assert.equal(edgeAt(0.4, 0.05), "top");
});
