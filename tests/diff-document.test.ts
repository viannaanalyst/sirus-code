import assert from "node:assert/strict";
import test from "node:test";
import { buildDiffDocument, fileIndex, FILE_ROW, lineOfRow, NOTICE_ROW, rowOfLine, searchableRows, widestLine } from "../src/lib/diff-document.ts";
import { reviewDiffLines } from "../src/lib/diff-comment.ts";
import { findDiffMatches } from "../src/lib/diff-find.ts";

const diff = (name: string, count: number) => `--- a/${name}\n+++ b/${name}\n@@ -1,${count} +1,${count} @@\n${Array.from({ length: count }, (_, i) => `+${name} line ${i}`).join("\n")}\n`;
const file = (path: string, count: number) => ({ path, lines: reviewDiffLines(diff(path, count)), message: null });

test("a review is header + rows per file, with a notice for files without text", () => {
  const files = [file("a.ts", 2), { path: "b.bin", lines: [], message: "Binary" }, file("c.ts", 1)];
  const doc = buildDiffDocument(files);
  assert.equal(doc.headers, true);
  // a.ts: header + 5 parsed rows (---, +++, @@, 2 additions); b.bin: header + notice; c.ts: header + 4.
  assert.equal(doc.length, 1 + 5 + 2 + 1 + 4);
  assert.deepEqual([...doc.fileRow], [0, 6, 8]);
  assert.equal(doc.rowLine[0], FILE_ROW);
  assert.equal(doc.rowLine[7], NOTICE_ROW);
  assert.equal(lineOfRow(doc, 4)?.content, "+a.ts line 0");
  assert.equal(lineOfRow(doc, 0), null);
  assert.equal(rowOfLine(doc, 2, 3), 12);
  assert.equal(rowOfLine(doc, 2, 9), -1);
  assert.equal(fileIndex(doc, "c.ts"), 2);
  assert.equal(fileIndex(doc, null), -1);
});

test("collapsed files keep only their header", () => {
  const files = [file("a.ts", 3), file("b.ts", 3)];
  const doc = buildDiffDocument(files, new Set(["a.ts"]));
  assert.equal(doc.length, 1 + 1 + 6);
  assert.deepEqual([...doc.fileRow], [0, 1]);
  assert.equal(rowOfLine(doc, 0, 3), -1, "collapsed lines have no row");
  assert.equal(rowOfLine(doc, 1, 0), 2);
  // Find never matches header rows and skips collapsed files.
  const found = findDiffMatches(searchableRows(doc), "a.ts line");
  assert.equal(found.matches.length, 0);
  assert.equal(findDiffMatches(searchableRows(doc), "b.ts line").matches.length, 3);
});

test("a single file has no header and the widest line sets the scroll width", () => {
  const doc = buildDiffDocument([file("only.ts", 2)], new Set(["only.ts"]), false);
  assert.equal(doc.headers, false);
  assert.equal(doc.length, 5, "collapse does not apply without headers");
  assert.equal(doc.rowLine[0], 0);
  assert.equal(widestLine(reviewDiffLines("--- a\n+++ b\n@@ -1 +1 @@\n+\tx\n")), 11);
  assert.equal(doc.columns, "+only.ts line 0".length);
});

test("20 000 changed lines across 50 files build in a few milliseconds", () => {
  const files = Array.from({ length: 50 }, (_, index) => file(`src/file${index}.ts`, 400));
  const started = performance.now();
  const doc = buildDiffDocument(files);
  const elapsed = performance.now() - started;
  assert.equal(doc.length, 50 * (1 + 3 + 400));
  assert.ok(elapsed < 200, `built in ${elapsed.toFixed(1)} ms`);
});
