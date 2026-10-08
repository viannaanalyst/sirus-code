import assert from "node:assert/strict";
import test from "node:test";
import { remember } from "../src/lib/bounded-map.ts";

test("bounded caches keep the newest entries", () => {
  const map = new Map<string, number>();
  remember(map, "a", 1, 2);
  remember(map, "b", 2, 2);
  remember(map, "a", 3, 2);
  remember(map, "c", 4, 2);
  assert.deepEqual([...map], [["a", 3], ["c", 4]]);
});
