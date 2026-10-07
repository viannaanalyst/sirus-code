export const KEYBINDINGS = [
  { id: "new-session", label: "New Session", combo: "meta+n", group: "Session" },
  { id: "palette", label: "Command Palette", combo: "meta+k", group: "App" },
  { id: "open-project", label: "Open Project", combo: "meta+o", group: "Project" },
  { id: "settings", label: "Settings", combo: "meta+,", group: "App" },
  { id: "toggle-sidebar", label: "Toggle Sidebar", combo: "meta+b", group: "View" },
  { id: "toggle-context", label: "Toggle right panel", combo: "meta+\\", group: "View" },
  { id: "open-terminal", label: "Open Terminal", combo: "meta+`", group: "View" },
  { id: "stop-agent", label: "Stop Agent", combo: "meta+.", group: "Session" },
  { id: "back", label: "Back", combo: "meta+[", group: "App" },
  { id: "forward", label: "Forward", combo: "meta+]", group: "App" },
  { id: "open-files", label: "Open Files", combo: "meta+alt+o", group: "View" },
  { id: "open-browser", label: "Open Browser", combo: "meta+alt+b", group: "View" },
  { id: "toggle-environment", label: "Toggle Environment", combo: "meta+alt+e", group: "View" },
  { id: "find-in-conversation", label: "Find in conversation", combo: "meta+f", group: "Session" },
  { id: "search-conversations", label: "Search all conversations", combo: "meta+shift+f", group: "Session" },
  { id: "toggle-side-chat", label: "Toggle side chat", combo: "meta+alt+s", group: "Session" },
  { id: "send-new-thread", label: "Send and start new thread", combo: "meta+alt+enter", group: "Session" },
] as const;
export type ShortcutId = (typeof KEYBINDINGS)[number]["id"];
export type CustomShortcuts = Partial<Record<ShortcutId, string>>;

// Command is required so bindings never take over normal terminal/text input.
const RESERVED = new Set(["q", "w", "h", "m", "c", "v", "x", "a", "z", "r", "l", "t", "=", "-"]);
export function normalizeShortcutCombo(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const parts = value.toLowerCase().split("+").map((part) => part.trim().replace(/^(mod|cmd)$/, "meta"));
  const key = parts.pop();
  if (!key || !/^([a-z0-9,.;/\\[\]`']|enter)$/.test(key) || !parts.includes("meta")) return null;
  if (new Set(parts).size !== parts.length || parts.some((part) => !["meta", "alt", "shift"].includes(part))) return null;
  // ⌘↩ alone stays the composer's own queue/steer inversion (ADR-062).
  if (RESERVED.has(key) || (key === "enter" && parts.length === 1)) return null;
  return [...["meta", "alt", "shift"].filter((part) => parts.includes(part)), key].join("+");
}

export function effectiveShortcut(custom: CustomShortcuts | undefined, id: ShortcutId): string {
  return custom?.[id] ?? KEYBINDINGS.find((item) => item.id === id)!.combo;
}
export function shortcutLabel(combo: string): string {
  return combo.replace(/enter$/, "↩").replace("meta+", "⌘").replace("alt+", "⌥").replace("shift+", "⇧")
    .replace(/^⌘(⌥?)(⇧?)/, "$1$2⌘").toUpperCase();
}

/** Recover hand-edited/legacy data without ever disabling a default binding. */
export function sanitizeShortcuts(value: unknown): CustomShortcuts {
  const result: CustomShortcuts = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const entry of KEYBINDINGS) {
    const normalized = normalizeShortcutCombo((value as Record<string, unknown>)[entry.id]);
    if (normalized && normalized !== entry.combo) result[entry.id] = normalized;
  }
  for (let pass = 0; pass < KEYBINDINGS.length; pass++) {
    const seen = new Map<string, ShortcutId[]>();
    for (const { id } of KEYBINDINGS) {
      const combo = effectiveShortcut(result, id);
      seen.set(combo, [...(seen.get(combo) ?? []), id]);
    }
    const collisions = [...seen.values()].filter((ids) => ids.length > 1).flat();
    if (!collisions.length) break;
    for (const id of collisions) delete result[id];
  }
  return result;
}

export function validateShortcutChange(custom: CustomShortcuts, id: ShortcutId, combo: string): string | null {
  const normalized = normalizeShortcutCombo(combo);
  if (!normalized) return "shortcut.unsupported";
  return KEYBINDINGS.some((entry) => entry.id !== id && effectiveShortcut(custom, entry.id) === normalized)
    ? "shortcut.conflict" : null;
}

export function shortcutConflict(custom: CustomShortcuts, id: ShortcutId, combo: string) {
  const normalized = normalizeShortcutCombo(combo);
  return normalized ? KEYBINDINGS.find(entry => entry.id !== id && effectiveShortcut(custom, entry.id) === normalized) : undefined;
}

export function filterKeybindings(query: string, custom: CustomShortcuts, translate: (key: string) => string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return KEYBINDINGS.filter(entry => words.every(word => `${entry.id} ${translate(entry.label)} ${translate(entry.group)} ${translate(`keybindings.description.${entry.id}`)} ${effectiveShortcut(custom, entry.id)} ${shortcutLabel(effectiveShortcut(custom, entry.id))}`.toLowerCase().includes(word)));
}

/** Use physical punctuation/letters so Shift and Option do not change the key identity. */
export function shortcutEventKey(event: Pick<KeyboardEvent, "code" | "key">): string {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  const codes: Record<string, string> = { Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Backquote: "`" };
  return codes[event.code] ?? (event.key === " " ? "space" : event.key.toLowerCase());
}
