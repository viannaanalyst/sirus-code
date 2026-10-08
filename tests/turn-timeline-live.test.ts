import { test } from "node:test";
import assert from "node:assert/strict";
import { liveFoldBoundary } from "../src/lib/turn-timeline.ts";

test("a running turn folds everything before its newest paragraph", () => {
  const text = (start: number) => ({ kind: "text" as const, start, end: start + 1 });
  const work = { kind: "work" as const, items: [] };
  assert.equal(liveFoldBoundary([text(0), work, text(5), work]), 2);
  assert.equal(liveFoldBoundary([text(0), work]), 0);
  assert.equal(liveFoldBoundary([]), 0);
});
