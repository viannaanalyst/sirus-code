import assert from "node:assert/strict";
import { test } from "node:test";
import { editorWrap, markdownView, setEditorWrap, setMarkdownView } from "../src/lib/editor-preferences.ts";

test("wrap is on by default and Markdown opens as code until the person picks rendered", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
  assert.equal(editorWrap(storage), true);
  setEditorWrap(false, storage);
  assert.equal(editorWrap(storage), false);
  assert.equal(markdownView(storage), "code");
  setMarkdownView("preview", storage);
  assert.equal(markdownView(storage), "preview");
  assert.equal(editorWrap(null), true);
});
