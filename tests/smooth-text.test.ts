import test from "node:test";
import assert from "node:assert/strict";
import { smoothAdvance } from "../src/lib/use-smooth-text.ts";

test("streamed text advances at a steady pace and catches up after a burst", () => {
  assert.equal(smoothAdvance(0, 33), 0);
  assert.equal(smoothAdvance(10, 33), 2, "about 70 characters a second");
  assert.ok(smoothAdvance(1000, 33) > 40, "a large burst is caught up quickly");
  assert.equal(smoothAdvance(3, 1000), 3, "never past what arrived");
});
