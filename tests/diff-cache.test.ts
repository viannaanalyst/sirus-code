import assert from "node:assert/strict";
import test from "node:test";
import { BoundedCache, cachedDiffLines, clearParsedDiffs, PARSED_DIFF_MAX_ENTRIES } from "../src/lib/diff-cache.ts";
import { DIFF_VIEW_STATES, diffViewState, rememberDiffView } from "../src/lib/diff-view-state.ts";

test("the cache evicts the least recently used entry past its count", () => {
  const cache = new BoundedCache<string, number>(2);
  cache.set("a", 1); cache.set("b", 2);
  assert.equal(cache.get("a"), 1, "reading refreshes a");
  cache.set("c", 3);
  assert.equal(cache.has("b"), false);
  assert.deepEqual([cache.get("a"), cache.get("c")], [1, 3]);
  assert.equal(cache.size, 2);
});

test("the cache stays within its weight and refuses an entry heavier than the budget", () => {
  const cache = new BoundedCache<string, string>(10, 100);
  cache.set("a", "x", 60); cache.set("b", "y", 30);
  cache.set("c", "z", 50);
  assert.equal(cache.has("a"), false);
  assert.equal(cache.weight, 80);
  cache.set("huge", "w", 101);
  assert.equal(cache.has("huge"), false);
  assert.equal(cache.weight, 80);
  cache.set("b", "again", 10);
  assert.equal(cache.weight, 60, "replacing an entry replaces its weight");
  assert.equal(cache.delete("b"), true);
  assert.equal(cache.weight, 50);
});

test("a diff is parsed once and the same rows come back", () => {
  clearParsedDiffs();
  const text = "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n";
  const first = cachedDiffLines(text);
  assert.equal(cachedDiffLines(`${text}`), first);
  assert.equal(cachedDiffLines(""), cachedDiffLines(""));
  for (let index = 0; index < PARSED_DIFF_MAX_ENTRIES + 4; index++) cachedDiffLines(`${text}+${index}\n`);
  assert.notEqual(cachedDiffLines(text), first, "bounded: the oldest parse was evicted");
});

test("review tabs remember their place, bounded", () => {
  rememberDiffView("tab:1", { scrollTop: 420, collapsed: ["a.ts"], selected: "b.ts", origin: "b.ts" });
  rememberDiffView("tab:1", { scrollTop: Number.NaN });
  assert.deepEqual(diffViewState("tab:1"), { scrollTop: 0, scrollLeft: 0, collapsed: ["a.ts"], selected: "b.ts", origin: "b.ts" });
  assert.equal(diffViewState(undefined), undefined);
  assert.equal(rememberDiffView(undefined, { scrollTop: 1 }), undefined);
  for (let index = 0; index < DIFF_VIEW_STATES; index++) rememberDiffView(`other:${index}`, { scrollTop: index });
  assert.equal(diffViewState("tab:1"), undefined);
});
