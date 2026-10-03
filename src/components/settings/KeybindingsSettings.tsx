import { useState } from "react";
import { Command, RotateCcw, Search } from "lucide-react";
import type { AppSettings } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { filterKeybindings, KEYBINDINGS, type CustomShortcuts } from "@/lib/keybindings";
import { useAppStore } from "@/store/app-store";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { SettingsSection } from "./SettingsSection";
import { KeybindingRow } from "./KeybindingRow";
import "@/styles/keybindings.css";

export function KeybindingsSettings({ settings }: { settings: AppSettings }) {
  const t = useTranslation();
  const [query, setQuery] = useState("");
  const filtered = filterKeybindings(query, settings.customShortcuts, t);
  const groups = [...new Set(KEYBINDINGS.map(entry => entry.group))];
  const save = (customShortcuts: CustomShortcuts) => { const state = useAppStore.getState(); void state.saveSettings({ ...state.settings, customShortcuts }); };
  return <SettingsSection title={t("Keybindings")} description={t("keybindings.intro")} headerAction={<InteractiveButton variant="secondary" glow={false} disabled={!Object.keys(settings.customShortcuts).length} onClick={() => save({})}><RotateCcw size={14} aria-hidden="true" />{t("Restore defaults")}</InteractiveButton>}>
    <p className="keybinding-callout ui-description">{t("keybindings.help")}</p>
    <label className="keybinding-search">
      <Search size={14} aria-hidden="true" className="text-text-muted" />
      <input type="search" aria-label={t("keybindings.search")} placeholder={t("keybindings.search")} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); setQuery(""); } }} className="min-w-0 flex-1 bg-transparent ui-control outline-none" />
      <Command size={13} aria-hidden="true" className="text-text-muted" />
    </label>
    <div className="keybinding-table" role="group" aria-label={t("Keybindings")}>
      <div className="keybinding-table-head ui-caption">
        <span>{t("keybindings.command")}</span>
        <span role="status">{t("keybindings.count", { shown: filtered.length, total: KEYBINDINGS.length })}</span>
        <span>{t("keybindings.binding")}</span>
      </div>
      {!filtered.length && <p className="px-4 py-6 text-center ui-control text-text-muted">{t("keybindings.noMatch")}</p>}
      {groups.map(group => {
        const entries = filtered.filter(entry => entry.group === group);
        return entries.length ? <section key={group} aria-label={t(group)}>
          <h3 className="keybinding-group ui-caption">{t(group)}</h3>
          {entries.map(entry => <KeybindingRow key={entry.id} id={entry.id} label={t(entry.label)} custom={settings.customShortcuts} onChange={change => { const next = { ...useAppStore.getState().settings.customShortcuts }; if (change[entry.id]) next[entry.id] = change[entry.id]; else delete next[entry.id]; save(next); }} />)}
        </section> : null;
      })}
    </div>
  </SettingsSection>;
}
