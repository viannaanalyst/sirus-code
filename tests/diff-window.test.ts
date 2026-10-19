import assert from "node:assert/strict";
import test from "node:test";
import { DIFF_ROW_HEIGHT, RowLayout, scrollToReveal, windowRows, wrappedLines } from "../src/lib/diff-window.ts";

test("offsets follow estimates until rows are measured", () => {
  const layout = new RowLayout(5, (row) => row === 0 ? 36 : 20);
  assert.equal(layout.offsetOf(0), 0);
  assert.equal(layout.offsetOf(1), 36);
  assert.equal(layout.total, 36 + 4 * 20);
  assert.equal(layout.measure(2, 44), true);
  assert.equal(layout.measure(2, 44.2), false, "sub-pixel changes are ignored");
  assert.equal(layout.offsetOf(3), 36 + 20 + 44);
  assert.equal(layout.total, 36 + 3 * 20 + 44);
  layout.setEstimate(() => 10);
  assert.equal(layout.total, 4 * 10 + 44, "measurements outlive a new estimate");
  assert.equal(layout.measure(-1, 10), false);
  assert.equal(layout.measure(9, 10), false);
  assert.equal(layout.heightOf(9), 0);
});

test("rowAt finds the row covering a position", () => {
  const layout = new RowLayout(4, () => 20);
  assert.equal(layout.rowAt(-5), 0);
  assert.equal(layout.rowAt(0), 0);
  assert.equal(layout.rowAt(19.9), 0);
  assert.equal(layout.rowAt(20), 1);
  assert.equal(layout.rowAt(79), 3);
  assert.equal(layout.rowAt(10_000), 3);
  assert.equal(new RowLayout(0, () => 20).rowAt(50), 0);
  assert.equal(new RowLayout(3, () => Number.NaN).heightOf(1), DIFF_ROW_HEIGHT, "bad estimates fall back to one row");
});

test("the window covers the viewport plus overscan, snapped to the quantum", () => {
  const layout = new RowLayout(20_000, () => 20);
  assert.deepEqual(windowRows(layout, 0, 800, 600, 16), { start: 0, end: 80 });
  // 10 000 px down: rows 470..570 with overscan, snapped outwards to multiples of 16.
  assert.deepEqual(windowRows(layout, 10_000, 10_800, 600, 16), { start: 464, end: 576 });
  // A small scroll inside the same quantum keeps the same window, so nothing re-renders.
  assert.deepEqual(windowRows(layout, 10_010, 10_810, 600, 16), { start: 464, end: 576 });
  assert.deepEqual(windowRows(layout, 399_000, 400_500, 600, 16), { start: 19_920, end: 20_000 }, "clamped at the end");
  assert.deepEqual(windowRows(new RowLayout(0, () => 20), 0, 800), { start: 0, end: 0 });
  const mounted = windowRows(layout, 123_456, 124_256);
  assert.ok(mounted.end - mounted.start < 150, "a 20k-row diff mounts about a screen and a half of rows");
});

test("revealing rows keeps visible ones still and brings others in", () => {
  const layout = new RowLayout(100, () => 20);
  assert.equal(scrollToReveal(layout, 5, 5, 0, 400), 0, "already visible");
  assert.equal(scrollToReveal(layout, 50, 50, 0, 400), 50 * 20 + 20 - 400, "below: its bottom meets the viewport's");
  assert.equal(scrollToReveal(layout, 2, 2, 400, 400), 40, "above: its top meets the viewport's");
  assert.equal(scrollToReveal(layout, 2, 2, 30, 400, { margin: 36 }), 4, "a pinned header's margin is kept clear");
  assert.equal(scrollToReveal(layout, 50, 50, 0, 400, { center: true }), 1000 - 190);
  assert.equal(scrollToReveal(layout, 0, 0, 0, 400, { center: true }), 0);
});

test("wrapped rows are estimated from their length", () => {
  assert.equal(wrappedLines(0, 80), 1);
  assert.equal(wrappedLines(80, 80), 1);
  assert.equal(wrappedLines(81, 80), 2);
  assert.equal(wrappedLines(500, 0), 500);
});
