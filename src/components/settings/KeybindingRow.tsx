import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "@/i18n/use-translation";
import { effectiveShortcut, KEYBINDINGS, normalizeShortcutCombo, shortcutConflict, shortcutEventKey, validateShortcutChange, type CustomShortcuts, type ShortcutId } from "@/lib/keybindings";

const MODIFIERS: Record<string, string> = { meta: "⌘", alt: "⌥", shift: "⇧" };

/** macOS order (⌥ ⇧ ⌘) followed by the key, one cap per part. */
function keyCaps(combo: string) {
  const parts = combo.split("+");
  const key = parts.pop() ?? "";
  return [...["alt", "shift", "meta"].filter(part => parts.includes(part)).map(part => MODIFIERS[part]), key === "enter" ? "↩" : key.toUpperCase()];
}

export function KeyCaps({ combo, muted = false }: { combo: string; muted?: boolean }) {
  return <span className="keybinding-caps" data-muted={muted || undefined} aria-hidden="true">{keyCaps(combo).map((cap, index) => <kbd key={index}>{cap}</kbd>)}</span>;
}

export function KeybindingRow({ label, id, custom, onChange }: { label: string; id: ShortcutId; custom: CustomShortcuts; onChange: (custom: CustomShortcuts) => void }) {
  const t = useTranslation();
  const original = KEYBINDINGS.find((item) => item.id === id)!.combo;
  const current = effectiveShortcut(custom, id);
  const [editing, setEditing] = useState(false);
  const [captured, setCaptured] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setEditing(false); setCaptured(null); setError(null); };
  const commit = (combo: string) => {
    const next = { ...custom };
    if (combo === original) delete next[id]; else next[id] = combo;
    onChange(next);
    close();
  };
  const capture = (event: KeyboardEvent<HTMLInputElement>) => {
    // The field owns every key while it is focused, so app shortcuts and Settings' Escape never fire.
    // Tab moves focus, except a modified Tab for the composer's effort cycle.
    if (event.key === "Tab" && !(id === "cycle-effort" && (event.shiftKey || event.altKey || event.metaKey))) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") { close(); return; }
    // Plain Enter confirms; Enter with modifiers is captured (send and start new thread).
    if (event.key === "Enter" && !event.metaKey && !event.altKey && !event.shiftKey && captured && !error) { commit(captured); return; }
    if (event.key === "Backspace") { setCaptured(null); setError(null); return; }
    if (["Meta", "Alt", "Shift", "Control"].includes(event.key)) return;
    const raw = [event.metaKey && "meta", event.altKey && "alt", event.shiftKey && "shift", shortcutEventKey(event)].filter(Boolean).join("+");
    const combo = normalizeShortcutCombo(raw, id);
    if (!combo) { setCaptured(null); setError(t("shortcut.unsupported")); return; }
    const conflict = shortcutConflict(custom, id, combo);
    const invalid = validateShortcutChange(custom, id, combo);
    setCaptured(combo);
    setError(conflict ? t("keybindings.occupied", { action: t(conflict.label) }) : invalid ? t(invalid) : null);
  };
  return (
    <div className="keybinding-row" data-keybinding-row={id} data-editing={editing || undefined}>
      <div className="keybinding-row-main">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="ui-control font-medium text-text-primary">{label}</span>
            {custom[id] && <span className="keybinding-badge ui-micro">{t("keybindings.changed")}</span>}
          </div>
          <p className="mt-0.5 ui-description text-text-muted">{t(`keybindings.description.${id}`)}</p>
        </div>
        <KeyCaps combo={current} />
        <span className="sr-only">{current}</span>
        {!editing && <button type="button" className="keybinding-action" aria-label={t("keybindings.editLabel", { action: label })} onClick={() => setEditing(true)}>{t("keybindings.edit")}</button>}
      </div>
      {editing && <div className="keybinding-edit">
        <div className="keybinding-capture" data-invalid={error ? true : undefined}>
          <input autoFocus readOnly data-shortcut-recording="true" aria-label={t("keybindings.captureLabel", { action: label })} aria-invalid={error ? true : undefined}
            placeholder={captured ? "" : t("keybindings.press")} onKeyDown={capture} />
          {captured && <KeyCaps combo={captured} />}
        </div>
        {custom[id] && <button type="button" className="keybinding-action" onClick={() => commit(original)}>{t("keybindings.useDefault")}</button>}
        <button type="button" className="keybinding-action" data-primary disabled={!captured || !!error || captured === current} onClick={() => captured && commit(captured)}>{t("common.save")}</button>
        <button type="button" className="keybinding-action" onClick={close}>{t("common.cancel")}</button>
        {error && <p role="alert" className="keybinding-error ui-caption">{error}</p>}
      </div>}
    </div>
  );
}
