import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROJECT_PARENT, lastProjectParent, projectSlug, projectTarget, rememberProjectParent, validProjectName } from "../src/lib/new-project.ts";
import { readFileSync } from "node:fs";

test("project slugs match the native folder names", () => {
  assert.equal(projectSlug("Meu Projeto Incrível"), "meu-projeto-incrivel");
  assert.equal(projectSlug("  ../../etc/passwd "), "etc-passwd");
  assert.equal(projectSlug("Ação & Reação!"), "acao-reacao");
  assert.equal(projectSlug("🚀🚀"), null);
  assert.ok((projectSlug("a".repeat(200)) ?? "").length <= 64);
  // The native side folds the same accents (src-tauri/src/new_project.rs).
  const native = readFileSync(new URL("../src-tauri/src/new_project.rs", import.meta.url), "utf8");
  for (const accent of ["ã", "ç", "õ", "ü", "ñ"]) assert.ok(native.includes(`'${accent}'`), accent);
});

test("names are validated and the target previewed under the parent", () => {
  assert.equal(validProjectName("Sirus"), true);
  for (const bad of ["", "   ", "bad\nname", "x".repeat(101), "!!!"]) assert.equal(validProjectName(bad), false, bad);
  assert.equal(projectTarget("~/Projetos/", "Meu App"), "~/Projetos/meu-app");
  assert.equal(projectTarget("", "Meu App"), null);
});

test("the last parent folder is remembered", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
  assert.equal(lastProjectParent(storage), DEFAULT_PROJECT_PARENT);
  rememberProjectParent(" /Users/me/code ", storage);
  assert.equal(lastProjectParent(storage), "/Users/me/code");
  assert.equal(lastProjectParent(undefined), DEFAULT_PROJECT_PARENT);
});
