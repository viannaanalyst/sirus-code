import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveShortcut, filterKeybindings, KEYBINDINGS, normalizeShortcutCombo, sanitizeShortcuts, shortcutConflict, validateShortcutChange, shortcutLabel } from "../src/lib/keybindings.ts";
import { createShortcutController, escapeStopsAgent, workspaceShortcutsAvailable } from "../src/lib/shortcuts.ts";
import { translate } from "../src/i18n/index.ts";
import { readFileSync } from "node:fs";

test("keyboard search uses translated commands, descriptions, categories and live overridden combinations", () => {
  const t = (key: string) => translate("pt-BR", key);
  assert.deepEqual(filterKeybindings("navegador", {}, t).map(row => row.id), ["open-browser"]);
  assert.deepEqual(filterKeybindings("shift+y", { "open-browser": "meta+shift+y" }, t).map(row => row.id), ["open-browser"]);
  assert.equal(filterKeybindings("not found", {}, t).length, 0);
  assert.equal(shortcutConflict({}, "open-files", "meta+alt+b")?.id, "open-browser");
  // Persisted frontend commands must be accepted by the independently maintained native boundary.
  const native = readFileSync(new URL("../src-tauri/src/models.rs", import.meta.url), "utf8").split("const BINDINGS:")[1].split("];", 1)[0];
  const bindings = [...native.matchAll(/\("([^"]+)", "([^"]+)"\)/g)].map(match => [match[1], match[2].replaceAll("\\\\", "\\")]);
  assert.deepEqual(bindings, KEYBINDINGS.map(row => [row.id, row.combo]));
});
test("workspace context prevents pane commands behind settings, palettes and dialogs", () => {
  const state = { settingsOpen: false, paletteOpen: false, newSessionOpen: false, mainView: "session", selectedSessionId: "owned" };
  assert.equal(workspaceShortcutsAvailable(state), true);
  for (const change of [{ settingsOpen: true }, { paletteOpen: true }, { newSessionOpen: true }, { mainView: "kanban" }, { selectedSessionId: null }]) assert.equal(workspaceShortcutsAvailable({ ...state, ...change }), false);
});

test("custom shortcuts require Command and preserve system/editing shortcuts", () => {
  assert.equal(effectiveShortcut({}, "find-in-conversation"), "meta+f");
  assert.equal(effectiveShortcut({ "find-in-conversation": "meta+alt+f" }, "find-in-conversation"), "meta+alt+f");
  assert.equal(validateShortcutChange({}, "find-in-conversation", "meta+shift+f"), "shortcut.conflict");
  assert.equal(normalizeShortcutCombo("mod+shift+b"), "meta+shift+b");
  for (const combo of ["b", "alt+b", "meta+q", "meta+w", "meta+c", "meta+shift+z", "meta+space", "meta+shift+meta+b", "meta+a+b"]) {
    assert.equal(normalizeShortcutCombo(combo), null, combo);
  }
  assert.equal(shortcutLabel("meta+shift+b"), "⇧⌘B");
});
test("collision validation accounts for defaults and overrides", () => {
  assert.equal(validateShortcutChange({}, "toggle-sidebar", "meta+n"), "shortcut.conflict");
  assert.equal(validateShortcutChange({}, "toggle-sidebar", "meta+shift+b"), null);
  assert.equal(validateShortcutChange({ palette: "meta+shift+b" }, "toggle-sidebar", "meta+shift+b"), "shortcut.conflict");
  const recovered = sanitizeShortcuts({ palette: "meta+n", "toggle-sidebar": "meta+shift+b", unknown: "meta+y", settings: "meta+q" });
  assert.deepEqual(recovered, { "toggle-sidebar": "meta+shift+b" });
  assert.equal(effectiveShortcut(recovered, "palette"), "meta+k");
  assert.equal(effectiveShortcut(recovered, "toggle-sidebar"), "meta+shift+b");
});
test("controller matches shifted physical punctuation, ignores composition, repeats and local recording", () => {
  class Element { closest() { return null; } }
  const original = { HTMLElement: globalThis.HTMLElement, HTMLTextAreaElement: globalThis.HTMLTextAreaElement, HTMLInputElement: globalThis.HTMLInputElement };
  Object.assign(globalThis, { HTMLElement: Element, HTMLTextAreaElement: Element, HTMLInputElement: Element });
  try {
    let count = 0;
    const controller = createShortcutController(() => [{ id: "fixture", combo: "meta+shift+.", run: () => count++ }]);
    const event = { key: ">", code: "Period", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true, repeat: false, isComposing: false, defaultPrevented: false, target: null, preventDefault() {} } as unknown as KeyboardEvent;
    controller(event);
    controller({ ...event, repeat: true });
    controller({ ...event, isComposing: true });
    controller({ ...event, defaultPrevented: true });
    createShortcutController(() => [{ id: "blocked", combo: "meta+shift+.", when: () => false, run: () => count++ }])(event);
    assert.equal(count, 1);
  } finally { Object.assign(globalThis, original); }
});

test("Escape stops only the selected live agent and only from the conversation", () => {
  const state = { settingsOpen: false, paletteOpen: false, newSessionOpen: false, environmentOpen: false, mainView: "session", selectedSessionId: "owned", sessions: [{ id: "owned", status: "running" }, { id: "other", status: "running" }] };
  const element = (inside: boolean, tagName = "BUTTON") => ({ tagName, closest: () => (inside ? {} : null) });
  assert.equal(escapeStopsAgent(state, null), true);
  assert.equal(escapeStopsAgent(state, element(false, "BODY") as unknown as EventTarget), true);
  assert.equal(escapeStopsAgent(state, element(true, "TEXTAREA") as unknown as EventTarget), true);
  // Menus, dialogs and other panes keep Escape for closing themselves.
  assert.equal(escapeStopsAgent(state, element(false) as unknown as EventTarget), false);
  for (const status of ["starting", "waiting"]) assert.equal(escapeStopsAgent({ ...state, sessions: [{ id: "owned", status }] }, null), true);
  for (const status of ["idle", "completed", "failed", "stopped"]) assert.equal(escapeStopsAgent({ ...state, sessions: [{ id: "owned", status }] }, null), false);
  for (const change of [{ environmentOpen: true }, { settingsOpen: true }, { paletteOpen: true }, { newSessionOpen: true }, { mainView: "kanban" }, { selectedSessionId: "missing" }]) assert.equal(escapeStopsAgent({ ...state, ...change }, null), false);
});
