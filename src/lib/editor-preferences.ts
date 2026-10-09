/**
 * Editor reading preferences (after T3), kept on this Mac: word wrap for every file (on by
 * default) and whether Markdown opens as code or rendered. A preference, not a property of
 * one file, so it carries to the next file and across restarts.
 */
const WRAP = "sirus.editor.wrap";
const MARKDOWN_VIEW = "sirus.editor.markdownView";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
const store = (): Storage | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function editorWrap(storage: Storage | null = store()): boolean {
  return storage?.getItem(WRAP) !== "off";
}
export function setEditorWrap(on: boolean, storage: Storage | null = store()) {
  storage?.setItem(WRAP, on ? "on" : "off");
}
export function markdownView(storage: Storage | null = store()): "code" | "preview" {
  return storage?.getItem(MARKDOWN_VIEW) === "preview" ? "preview" : "code";
}
export function setMarkdownView(view: "code" | "preview", storage: Storage | null = store()) {
  storage?.setItem(MARKDOWN_VIEW, view);
}
