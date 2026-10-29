import { test } from "node:test";
import assert from "node:assert/strict";
import { PIXEL_RING, pixelRingPositions, rowStatus } from "../src/lib/conversation-row-status.ts";

test("the corner status follows the row's signal", () => {
  assert.equal(rowStatus("running", false), "working");
  assert.equal(rowStatus("running", true), "working");
  assert.equal(rowStatus("waiting", true), "needsYou");
  assert.equal(rowStatus("done", false), "done");
  assert.equal(rowStatus("done", true), null, "the open conversation counts as seen");
  assert.equal(rowStatus("idle", false), null);
});

test("the pixel spinner visits every cell once, clockwise from the top left", () => {
  assert.deepEqual([...PIXEL_RING].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(pixelRingPositions(), [0, 1, 3, 5, 4, 2]);
});
