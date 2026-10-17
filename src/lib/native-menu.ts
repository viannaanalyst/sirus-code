/**
 * Where the webview's own right-click menu helps: text fields and editors (spelling, paste),
 * terminals, links, images and video, and selected text (copy, look up). Elsewhere it only
 * offers Reload, so a right click on empty window space shows nothing.
 */
const NATIVE_MENU_TARGETS = "input, textarea, select, [contenteditable]:not([contenteditable='false']), .cm-editor, .xterm, a[href], img, video, audio";

export function keepsNativeMenu(target: { closest(selector: string): unknown } | null, selectedText: string): boolean {
  return selectedText.trim().length > 0 || !!target?.closest(NATIVE_MENU_TARGETS);
}
