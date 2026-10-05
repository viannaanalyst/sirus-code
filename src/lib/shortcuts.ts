import { shortcutEventKey } from "./keybindings";

export interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  group: string;
  shortcut?: string;
  /** Leading glyph (app icon or provider mark). */
  icon?: import("react").ReactNode;
  /** Muted trailing text, e.g. a chat's project. */
  meta?: string;
  run: () => void;
}

export interface ShortcutBinding {
  id: string;
  combo: string;
  run: (event: KeyboardEvent) => void;
  when?: () => boolean;
}

export function workspaceShortcutsAvailable(state: { settingsOpen: boolean; paletteOpen: boolean; newSessionOpen: boolean; mainView: string; selectedSessionId: string | null }) {
  return !state.settingsOpen && !state.paletteOpen && !state.newSessionOpen && state.mainView === "session" && state.selectedSessionId !== null;
}

/**
 * Escape interrupts the selected running agent, like a terminal CLI, but only from the
 * conversation itself (composer, transcript or no focus). Escape inside menus, dialogs,
 * the Environment card or other panes keeps closing those first.
 */
export function escapeStopsAgent(
  state: { settingsOpen: boolean; paletteOpen: boolean; newSessionOpen: boolean; mainView: string; selectedSessionId: string | null; environmentOpen: boolean; sessions: { id: string; status: string }[] },
  target: EventTarget | null,
) {
  if (!workspaceShortcutsAvailable(state) || state.environmentOpen) return false;
  const status = state.sessions.find(session => session.id === state.selectedSessionId)?.status;
  if (status !== "running" && status !== "starting" && status !== "waiting") return false;
  const element = target as Element | null;
  if (typeof element?.closest !== "function" || element.tagName === "BODY" || element.tagName === "HTML") return true;
  // A side chat's composer belongs to another session (ADR-049).
  if (element.closest("[data-side-chat]")) return false;
  return element.closest("[data-draft-owner], .transcript-scroll") !== null;
}

function matches(event: KeyboardEvent, combo: string) {
  const parts = combo.toLowerCase().split("+");
  const key = parts.at(-1);
  const needMeta = parts.includes("meta") || parts.includes("cmd");
  const needShift = parts.includes("shift");
  const needAlt = parts.includes("alt");
  const eventKey = shortcutEventKey(event);
  return (
    eventKey === key &&
    event.metaKey === needMeta &&
    event.shiftKey === needShift &&
    event.altKey === needAlt &&
    event.ctrlKey === parts.includes("ctrl") &&
    !event.repeat
  );
}

export function createShortcutController(bindings: () => ShortcutBinding[]) {
  return (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-terminal]") && !event.metaKey) return;
    const typing =
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLInputElement ||
      target?.isContentEditable;
    for (const binding of bindings()) {
      if (!matches(event, binding.combo)) continue;
      if (binding.when && !binding.when()) continue;
      if (typing && !event.metaKey && binding.combo.toLowerCase() !== "escape") {
        continue;
      }
      event.preventDefault();
      binding.run(event);
      return;
    }
  };
}
