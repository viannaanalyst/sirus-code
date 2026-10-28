import test from "node:test";
import assert from "node:assert/strict";
import { DIFF_FIND_LIMIT, findDiffMatches, locateRow, searchRows, stepDiffMatch } from "../src/lib/diff-find.ts";
import { reviewDiffLines } from "../src/lib/diff-comment.ts";

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
});

const diff = (name: string, ...added: string[]) => `--- a/${name}\n+++ b/${name}\n@@ -1,1 +1,${added.length} @@\n${added.map((text) => `+${text}`).join("\n")}\n`;

test("search rows hold the code as Pierre draws it, never headers or the +/- marker", () => {
  const files = [{ lines: reviewDiffLines(diff("a.ts", "const a = 1;", "const b = 2;")) }, { lines: reviewDiffLines(diff("b.ts", "let a;")) }];
  const index = searchRows(files);
  assert.equal(index.rows.length, 3 + 2 + 3 + 1);
  // Matching the marker or the file headers finds nothing.
  assert.equal(findDiffMatches(index.rows, "+").matches.length, 0);
  assert.equal(findDiffMatches(index.rows, "a.ts").matches.length, 0);
  const found = findDiffMatches(index.rows, "a");
  // "const a" (offset 6), "let a" (offset 4): offsets are within the code, after the marker.
  const first = found.matches.find((match) => index.rows[match.line].content === "const a = 1;");
  assert.deepEqual(first && { start: first.start, end: first.end }, { start: 6, end: 7 });
  const last = found.matches.at(-1)!;
  assert.deepEqual(locateRow(index, last), { file: 1, line: 3 });
});

test("collapsed files are not searched", () => {
  const files = [{ lines: reviewDiffLines(diff("a.ts", "needle")), collapsed: true }, { lines: reviewDiffLines(diff("b.ts", "needle")) }];
  const index = searchRows(files);
  const found = findDiffMatches(index.rows, "needle");
  assert.equal(found.matches.length, 1);
  assert.equal(locateRow(index, found.matches[0]).file, 1);
});
