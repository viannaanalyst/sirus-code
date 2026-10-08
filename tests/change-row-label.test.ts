import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { changeRowLabel } from "../src/lib/change-row-label.ts";

test("changed-file rows name the path, kind and +/− counts", () => {
  assert.equal(changeRowLabel({ path: "src/a.ts", kind: "Modified", additions: 2, deletions: 1 }), "src/a.ts, Modified, +2 −1");
  assert.equal(changeRowLabel({ action: "Review src/a.ts", path: "src/a.ts", kind: "Added", additions: 3 }), "Review src/a.ts, Added, +3 −0");
  assert.equal(changeRowLabel({ path: "img.png", kind: "Added", additions: 0, deletions: 0, status: "Binary" }), "img.png, Added, Binary");
  assert.equal(changeRowLabel({ path: "notes.md" }), "notes.md");
});

test("the dock Changes row button covers the whole row while row actions stay on top", () => {
  const css = readFileSync(new URL("../src/styles/changes.css", import.meta.url), "utf8");
  assert.match(css, /\.changes-row-main::after\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0/);
  assert.match(css, /\.changes-row-action\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1/);
  assert.match(css, /\.changes-row-main:focus-visible::after\s*\{[^}]*outline:/);
});
