import assert from "node:assert/strict";
import test from "node:test";
import { DIFF_CHUNK, diffCountFor, initialDiffCount, nextDiffCount, reservedDiffHeight } from "../src/lib/diff-window.ts";

test("a diff opens with one chunk and grows a chunk at a time up to its length", () => {
  assert.equal(initialDiffCount(0), 0);
  assert.equal(initialDiffCount(12), 12);
  assert.equal(initialDiffCount(10_000), DIFF_CHUNK);
  assert.equal(nextDiffCount(DIFF_CHUNK, 10_000), 2 * DIFF_CHUNK);
  assert.equal(nextDiffCount(DIFF_CHUNK, DIFF_CHUNK + 5), DIFF_CHUNK + 5);
  assert.equal(nextDiffCount(900, 900), 900);
  assert.equal(nextDiffCount(3, 100, 10), 13);
});

test("jumping to a row mounts up to the end of its chunk", () => {
  assert.equal(diffCountFor(0, 1000, 400), 400);
  assert.equal(diffCountFor(399, 1000, 400), 400);
  assert.equal(diffCountFor(400, 1000, 400), 800);
  assert.equal(diffCountFor(950, 1000, 400), 1000);
});

test("unmounted rows keep their space and bad input stays bounded", () => {
  assert.equal(reservedDiffHeight(400, 1000, 20), 12_000);
  assert.equal(reservedDiffHeight(1000, 1000, 20), 0);
  assert.equal(initialDiffCount(Number.NaN), 0);
  assert.equal(nextDiffCount(-5, 10, 0), 1);
  assert.equal(diffCountFor(Number.POSITIVE_INFINITY, 50, 400), 50);
});
