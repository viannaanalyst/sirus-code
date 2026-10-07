import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROJECT_ICON_NAMES, searchProjectIcons } from "../src/lib/project-icons.ts";

test("project icons match the native list and search in both languages", () => {
  const native = readFileSync(new URL("../src-tauri/src/project_look.rs", import.meta.url), "utf8");
  const list = /pub const ICONS: \[&str; \d+\] = \[([\s\S]*?)\];/.exec(native)?.[1] ?? "";
  assert.deepEqual([...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]), PROJECT_ICON_NAMES);
  assert.ok(searchProjectIcons("dinheiro").includes("currency-dollar"));
  assert.ok(searchProjectIcons("rocket").includes("rocket"));
  assert.equal(searchProjectIcons("").length, PROJECT_ICON_NAMES.length);
});
