import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { languageForPath } from "../src/lib/editor-language.ts";
import { envLanguage } from "../src/lib/env-language.ts";

test("stylesheets, components and .env files get their own editor language", () => {
  assert.equal(languageForPath("src/app.scss"), "scss");
  assert.equal(languageForPath("theme.SASS"), "sass");
  assert.equal(languageForPath("vars.less"), "less");
  assert.equal(languageForPath("App.vue"), "vue");
  assert.equal(languageForPath("Page.svelte"), "svelte");
  assert.equal(languageForPath("plain.css"), "css");
  for (const env of [".env", "apps/web/.env.local", ".env.production", "C:\\repo\\.env.example"]) assert.equal(languageForPath(env), "env", env);
  assert.equal(languageForPath(".envrc"), null);
  assert.equal(languageForPath("Makefile"), null);
  assert.equal(languageForPath("guide.MDX"), "markdown");
});

/** Highlight classes per token text, the way the editor's HighlightStyle sees them. */
function envTokens(doc: string) {
  const state = EditorState.create({ doc, extensions: envLanguage });
  const tree = ensureSyntaxTree(state, doc.length, 5000);
  assert.ok(tree);
  const tokens = new Map<string, string>();
  highlightTree(tree, classHighlighter, (from, to, classes) => tokens.set(doc.slice(from, to), classes));
  return tokens;
}

test(".env lines colour comments, keys, values and references", () => {
  const tokens = envTokens("# secrets\nexport API_KEY=abc # note\nURL=\"http://x\"\nPATH=$HOME/bin\n");
  assert.equal(tokens.get("# secrets"), "tok-comment");
  assert.equal(tokens.get("export"), "tok-keyword");
  assert.equal(tokens.get("API_KEY"), "tok-propertyName");
  assert.equal(tokens.get("abc"), "tok-string");
  assert.equal(tokens.get("# note"), "tok-comment");
  assert.equal(tokens.get("\"http://x\""), "tok-string");
  assert.match(tokens.get("$HOME") ?? "", /tok-variableName/);
});
