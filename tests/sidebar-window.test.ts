import { test } from "node:test";
import assert from "node:assert/strict";
import { windowRange } from "../src/lib/sidebar-window.ts";

test("a long sidebar list renders only rows near the visible area", () => {
  // 300 rows of 28 px (+2 px gap); the list starts 100 px into the scroll viewport.
  assert.deepEqual(windowRange(300, 28, 100, 0, 600), { start: 0, end: Math.ceil(500 / 30) + 12 });
  const middle = windowRange(300, 28, 100, 4000, 600);
  assert.equal(middle.start, Math.floor(3900 / 30) - 12);
  assert.equal(middle.end, Math.ceil(4500 / 30) + 12);
  assert.deepEqual(windowRange(300, 28, 100, 20_000, 600), { start: 300, end: 300 }, "past the end renders nothing");
  assert.deepEqual(windowRange(5, 28, 100, 0, 600), { start: 0, end: 5 });
});
