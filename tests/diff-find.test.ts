import test from "node:test";
import assert from "node:assert/strict";
import { DIFF_CHUNK } from "../src/lib/diff-window.ts";
import { DIFF_FIND_LIMIT, findDiffMatches, firstMatchFrom, mountedForMatch, splitByRanges, stepDiffMatch } from "../src/lib/diff-find.ts";

const lines = (...content: string[]) => content.map((text) => ({ content: text }));

test("matches are case-insensitive, non-overlapping and grouped per line", () => {
  const found = findDiffMatches(lines("Foo foo", "bar", "aaaa"), "foo");
  assert.deepEqual(found.matches, [{ line: 0, start: 0, end: 3 }, { line: 0, start: 4, end: 7 }]);
  assert.deepEqual(found.byLine.get(0), [[0, 3], [4, 7]]);
  assert.equal(found.byLine.has(1), false);
  assert.equal(findDiffMatches(lines("aaaa"), "aa").matches.length, 2, "no overlaps");
  assert.equal(findDiffMatches(lines("x"), "   ").matches.length, 0, "blank queries find nothing");
  const many = findDiffMatches(lines("a".repeat(DIFF_FIND_LIMIT + 10)), "a");
  assert.equal(many.matches.length, DIFF_FIND_LIMIT);
  assert.equal(many.truncated, true);
});

test("↑/↓/Enter wrap around the matches", () => {
  assert.equal(stepDiffMatch(-1, 3, 1), 0);
  assert.equal(stepDiffMatch(-1, 3, -1), 2);
  assert.equal(stepDiffMatch(2, 3, 1), 0);
  assert.equal(stepDiffMatch(0, 3, -1), 2);
  assert.equal(stepDiffMatch(0, 0, 1), -1);
  const found = findDiffMatches(lines("x", "y", "x"), "x").matches;
  assert.equal(firstMatchFrom(found, 1), 1);
  assert.equal(firstMatchFrom(found, 5), 0);
});

test("a match beyond the mounted rows mounts whole chunks up to it", () => {
  const total = DIFF_CHUNK * 5;
  assert.equal(mountedForMatch({ line: DIFF_CHUNK * 3 + 7, start: 0, end: 1 }, DIFF_CHUNK, total), DIFF_CHUNK * 4);
  assert.equal(mountedForMatch({ line: 3, start: 0, end: 1 }, DIFF_CHUNK * 2, total), DIFF_CHUNK * 2, "never unmounts");
  assert.equal(mountedForMatch(undefined, DIFF_CHUNK, total), DIFF_CHUNK);
});

test("rows split their text around the matches and mark the current one", () => {
  assert.deepEqual(splitByRanges("a foo b", [[2, 5]], 2), [
    { text: "a ", match: false, current: false }, { text: "foo", match: true, current: true }, { text: " b", match: false, current: false },
  ]);
  assert.deepEqual(splitByRanges("abc", undefined, null), [{ text: "abc", match: false, current: false }]);
  assert.deepEqual(splitByRanges("", [], null), [{ text: "", match: false, current: false }]);
});
