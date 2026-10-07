import test from "node:test";
import assert from "node:assert/strict";
import { buildDiffTree, diffTotals } from "../src/lib/diff-tree.ts";

test("changed files form a compact folder tree with summed stats", () => {
  const tree = buildDiffTree([
    { path: "src/components/b.tsx", additions: 2, deletions: 1 },
    { path: "src/components/a.tsx", additions: 3, deletions: 0 },
    { path: "README.md", additions: 1, deletions: 1 },
    { path: "img/logo.png", additions: 0, deletions: 0, binary: true },
  ]);
  assert.deepEqual(tree.map((node) => [node.kind, node.name]), [["directory", "img"], ["directory", "src/components"], ["file", "README.md"]]);
  const src = tree[1];
  assert.ok(src.kind === "directory");
  assert.deepEqual(src.stat, { additions: 5, deletions: 1 });
  assert.deepEqual(src.children.map((node) => node.name), ["a.tsx", "b.tsx"]);
  assert.equal(tree[0].kind === "directory" && tree[0].children[0].stat, null, "binary files have no line stat");
  assert.deepEqual(diffTotals([{ additions: 2, deletions: 1 }, { additions: 9, deletions: 9, binary: true }]), { additions: 2, deletions: 1 });
});
