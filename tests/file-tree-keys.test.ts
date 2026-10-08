import test from "node:test";
import assert from "node:assert/strict";
import { emptyTypeahead, isTypeaheadKey, literalRanges, parentIndex, treeKeyAction, typeahead, TYPEAHEAD_MS, workspaceFilePath, type TreeKeyRow } from "../src/lib/file-tree-keys.ts";

// root (open) > src (open) > [app.ts, api.ts], docs (closed), README.md, Rakefile
const rows: TreeKeyRow[] = [
  { name: "project", level: 1, isDir: true, expanded: true },
  { name: "src", level: 2, isDir: true, expanded: true },
  { name: "app.ts", level: 3, isDir: false, expanded: false },
  { name: "api.ts", level: 3, isDir: false, expanded: false },
  { name: "docs", level: 2, isDir: true, expanded: false },
  { name: "README.md", level: 2, isDir: false, expanded: false },
  { name: "Rakefile", level: 2, isDir: false, expanded: false },
];

test("arrows, Home/End and paging move within the visible rows", () => {
  assert.deepEqual(treeKeyAction(rows, 0, "ArrowDown"), { type: "focus", index: 1 });
  assert.deepEqual(treeKeyAction(rows, 6, "ArrowDown"), { type: "focus", index: 6 });
  assert.deepEqual(treeKeyAction(rows, 0, "ArrowUp"), { type: "focus", index: 0 });
  assert.deepEqual(treeKeyAction(rows, 3, "Home"), { type: "focus", index: 0 });
  assert.deepEqual(treeKeyAction(rows, 3, "End"), { type: "focus", index: 6 });
  assert.deepEqual(treeKeyAction(rows, 0, "PageDown", 4), { type: "focus", index: 3 });
  assert.deepEqual(treeKeyAction(rows, 5, "PageUp", 4), { type: "focus", index: 2 });
  assert.deepEqual(treeKeyAction(rows, 5, "PageDown", 40), { type: "focus", index: 6 });
  assert.deepEqual(treeKeyAction([], 0, "ArrowDown"), { type: "none" });
  assert.deepEqual(treeKeyAction(rows, 0, "x"), { type: "none" });
});

test("right expands or enters a folder; left collapses or climbs to the parent", () => {
  assert.deepEqual(treeKeyAction(rows, 4, "ArrowRight"), { type: "expand", index: 4 });
  assert.deepEqual(treeKeyAction(rows, 1, "ArrowRight"), { type: "focus", index: 2 });
  assert.deepEqual(treeKeyAction(rows, 2, "ArrowRight"), { type: "none" });
  // An open but empty folder has no first child to enter.
  assert.deepEqual(treeKeyAction([{ name: "empty", level: 1, isDir: true, expanded: true }], 0, "ArrowRight"), { type: "none" });
  assert.deepEqual(treeKeyAction(rows, 1, "ArrowLeft"), { type: "collapse", index: 1 });
  assert.deepEqual(treeKeyAction(rows, 3, "ArrowLeft"), { type: "focus", index: 1 });
  assert.deepEqual(treeKeyAction(rows, 4, "ArrowLeft"), { type: "focus", index: 0 });
  assert.deepEqual(treeKeyAction([{ ...rows[0], expanded: false }], 0, "ArrowLeft"), { type: "none" });
  assert.equal(parentIndex(rows, 5), 0);
  assert.equal(parentIndex(rows, 0), -1);
});

test("Enter and Space activate the current row", () => {
  assert.deepEqual(treeKeyAction(rows, 2, "Enter"), { type: "activate", index: 2 });
  assert.deepEqual(treeKeyAction(rows, 4, " "), { type: "activate", index: 4 });
});

test("typeahead jumps by prefix, cycles a repeated letter and resets after a pause", () => {
  const names = rows.map((row) => row.name);
  let step = typeahead(emptyTypeahead, "r", 1000, names, 0);
  assert.equal(step.index, 5);
  step = typeahead(step.state, "a", 1100, names, step.index);
  assert.equal(step.index, 6, "the longer prefix ra moves to Rakefile");
  let cycle = typeahead(emptyTypeahead, "a", 0, names, 0);
  assert.equal(cycle.index, 2);
  cycle = typeahead(cycle.state, "a", 100, names, cycle.index);
  assert.equal(cycle.index, 3, "a repeated letter cycles to the next a-row");
  cycle = typeahead(cycle.state, "a", 200, names, cycle.index);
  assert.equal(cycle.index, 2, "and wraps around");
  const later = typeahead(cycle.state, "d", 200 + TYPEAHEAD_MS + 1, names, cycle.index);
  assert.equal(later.state.buffer, "d");
  assert.equal(later.index, 4);
  assert.equal(typeahead(emptyTypeahead, "z", 0, names, 0).index, -1);
  assert.equal(typeahead(emptyTypeahead, "a", 0, [], 0).index, -1);
});

test("only plain printable keys feed the typeahead", () => {
  const plain = { metaKey: false, ctrlKey: false, altKey: false };
  assert.equal(isTypeaheadKey({ key: "a", ...plain }), true);
  assert.equal(isTypeaheadKey({ key: "A", ...plain }), true);
  assert.equal(isTypeaheadKey({ key: " ", ...plain }), false);
  assert.equal(isTypeaheadKey({ key: "ArrowDown", ...plain }), false);
  assert.equal(isTypeaheadKey({ key: "a", ...plain, metaKey: true }), false);
});

test("search highlights follow case sensitivity and paths join the root", () => {
  assert.deepEqual(literalRanges("Foo foo FOO", "foo", false), [{ start: 0, end: 3 }, { start: 4, end: 7 }, { start: 8, end: 11 }]);
  assert.deepEqual(literalRanges("Foo foo FOO", "foo", true), [{ start: 4, end: 7 }]);
  assert.deepEqual(literalRanges("aaaa", "aa", true), [{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  assert.deepEqual(literalRanges("text", "", false), []);
  assert.equal(workspaceFilePath("/repo/", "src/a.ts"), "/repo/src/a.ts");
});
