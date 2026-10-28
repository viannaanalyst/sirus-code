import test from "node:test";
import assert from "node:assert/strict";
import { addressOfLine, clearParsedPatches, fileDiffFor, lineAt, nextCodeRow, patchText, rowsOfSelection, selectionOfRows } from "../src/lib/diff-pierre.ts";
import { locateOffset, lineSelector } from "../src/lib/diff-find-dom.ts";
import { readableOnLightRows } from "../src/lib/diff-theme.ts";
import { reviewDiffLines } from "../src/lib/diff-comment.ts";

const GIT = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 keep
-old
+new
+added
 tail
`;

test("a git diff goes to Pierre as it is; bare hunks and untracked files get the headers they lack", () => {
  assert.equal(patchText("src/a.ts", GIT), GIT);
  assert.equal(patchText("a.ts", ""), "");
  assert.equal(patchText("a.ts", "no hunks here"), "");
  assert.equal(patchText("a.ts", "@@ -1 +1 @@\n-a\n+b\n"), "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n");
  const untracked = patchText("n.txt", "+++ untracked\none\ntwo\n");
  assert.match(untracked, /^diff --git a\/n\.txt b\/n\.txt\nnew file mode 100644\n--- \/dev\/null\n\+\+\+ b\/n\.txt\n@@ -0,0 \+1,2 @@\n\+one\n\+two\n$/);
  assert.equal(patchText("e.txt", "+++ untracked\n"), "", "an empty untracked file has nothing to draw");
});

test("fileDiffFor parses once per text and names the file by our path", () => {
  clearParsedPatches();
  const file = fileDiffFor("src/a.ts", GIT);
  assert.ok(file);
  assert.equal(file.name, "src/a.ts");
  assert.equal(file.hunks.length, 1);
  assert.equal(file.hunks[0].additionLines, 2);
  assert.equal(file.hunks[0].deletionLines, 1);
  assert.equal(fileDiffFor("src/a.ts", GIT), file, "cached");
  assert.equal(fileDiffFor("img.png", "Binary files a/img.png and b/img.png differ\n"), null);
  assert.equal(fileDiffFor("x", ""), null);
  const added = fileDiffFor("n.txt", "+++ untracked\none\ntwo\n");
  assert.equal(added?.type, "new");
  assert.equal(added?.hunks[0].additionLines, 2);
});

test("rows map to Pierre's gutter addresses and back", () => {
  const lines = reviewDiffLines(GIT);
  // Rows: 0-3 headers, 4 @@, 5 keep, 6 old, 7 new, 8 added, 9 tail.
  assert.equal(addressOfLine(lines[0]), null);
  assert.deepEqual(addressOfLine(lines[6]), { side: "deletions", lineNumber: 2 });
  assert.deepEqual(addressOfLine(lines[7]), { side: "additions", lineNumber: 2 });
  assert.deepEqual(addressOfLine(lines[9]), { side: "additions", lineNumber: 4 });
  assert.equal(lineAt(lines, "deletions", 2), 6);
  assert.equal(lineAt(lines, "additions", 2), 7);
  assert.equal(lineAt(lines, "additions", 99), -1);

  const selection = selectionOfRows(lines, 0, 8);
  assert.deepEqual(selection, { start: 1, side: "additions", end: 3, endSide: "additions" }, "headers are skipped");
  assert.deepEqual(rowsOfSelection(lines, selection!), { from: 5, to: 8 });
  // A range that starts on a removed line and ends on an added one covers the rows between.
  assert.deepEqual(rowsOfSelection(lines, { start: 2, side: "deletions", end: 3, endSide: "additions" }), { from: 6, to: 8 });
  assert.deepEqual(rowsOfSelection(lines, { start: 3, side: "additions", end: 1, endSide: "additions" }), { from: 5, to: 8 }, "reversed drags");
  assert.equal(rowsOfSelection(lines, { start: 50, side: "additions", end: 51 }), null);
  assert.equal(selectionOfRows(lines, 0, 4), null, "headers only");
});

test("keyboard moves skip header rows", () => {
  const lines = reviewDiffLines(`${GIT}@@ -20,1 +21,1 @@\n-x\n+y\n`);
  assert.equal(nextCodeRow(lines, 9, 1), 11, "the second hunk's @@ row is skipped");
  assert.equal(nextCodeRow(lines, 5, -1), -1, "nothing code-like above the first row");
  assert.equal(nextCodeRow(lines, 12, 1), -1);
});

test("find marks are placed with offsets across text nodes", () => {
  // "ab" "cde" "f": offset 4 is inside the second node, 5 is the end of it.
  assert.deepEqual(locateOffset([2, 3, 1], 0), { node: 0, offset: 0 });
  assert.deepEqual(locateOffset([2, 3, 1], 2), { node: 1, offset: 0 });
  assert.deepEqual(locateOffset([2, 3, 1], 4), { node: 1, offset: 2 });
  assert.deepEqual(locateOffset([2, 3, 1], 5, true), { node: 1, offset: 3 }, "an end offset may land on a node's end");
  assert.deepEqual(locateOffset([2, 3, 1], 6, true), { node: 2, offset: 1 });
  assert.equal(locateOffset([2, 3, 1], 7, true), null);
  const lines = reviewDiffLines(GIT);
  assert.equal(lineSelector(lines[0]), null);
  assert.equal(lineSelector(lines[7]), '[data-line-type="change-addition"][data-line="2"]');
  assert.equal(lineSelector(lines[6]), '[data-line-type="change-deletion"][data-line="2"]');
  assert.match(lineSelector(lines[5])!, /context.*\[data-line="1"\]/);
});

test("light syntax colours are darkened until they read on tinted rows", () => {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255).map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const yellow = readableOnLightRows("#d5a910");
  assert.notEqual(yellow, "#d5a910");
  assert.ok((0.78 + 0.05) / (luminance(yellow) + 0.05) >= 4.5);
  assert.equal(readableOnLightRows("#101010"), "#101010", "dark colours stay");
  assert.equal(readableOnLightRows("rgb(1,2,3)"), "rgb(1,2,3)", "other formats pass through");
  assert.equal(readableOnLightRows("#d5a91080").length, 9, "alpha is kept");
});
