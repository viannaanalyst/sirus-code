import { useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Search, X } from "@/components/icons";
import { client } from "@/client";
import type { AppSettings, VsCodeTheme, VsCodeThemeExtension } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { MAX_INSTALLED_THEMES, mapVsCodeTheme } from "@/lib/vscode-theme";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { Select } from "@/primitives/Select";
import { SettingsGroup, SettingsRow } from "./SettingsSection";
import "@/styles/vscode-themes.css";

type Sort = "downloadCount" | "rating" | "timestamp" | "relevance";
const SORTS: Sort[] = ["downloadCount", "rating", "timestamp", "relevance"];
const DEFAULT = "__default__";

/** A miniature window painted with the theme's mapped colours: surfaces, text, accent and a line of code. */
export function ThemePreview({ theme }: { theme: VsCodeTheme }) {
  const mapped = mapVsCodeTheme(theme);
  const syntax = mapped.syntax.syntax;
  const style = { "--preview-bg": mapped.swatches.background, "--preview-surface": mapped.swatches.surface, "--preview-text": mapped.swatches.text, "--preview-muted": mapped.swatches.muted, "--preview-accent": mapped.swatches.accent, "--preview-border": mapped.swatches.border } as CSSProperties;
  const color = (key: string) => ({ color: syntax[key]?.color, fontStyle: syntax[key]?.font_style });
  return <div className="vscode-theme-preview" style={style} aria-hidden="true">
    <div className="vscode-theme-preview-side"><i /><i /><i /></div>
    <div className="vscode-theme-preview-main">
      <span className="vscode-theme-preview-title">{theme.name}</span>
      <code>
        <span style={color("keyword")}>const</span> <span style={color("variable")}>greeting</span> <span style={color("operator")}>=</span> <span style={color("string")}>&quot;hello&quot;</span><span style={color("punctuation")}>;</span> <span style={color("comment")}>{"// "}{theme.kind}</span>
      </code>
      <span className="vscode-theme-preview-chips"><b style={{ background: mapped.swatches.accent }} /><b style={{ background: mapped.css["--success"] }} /><b style={{ background: mapped.css["--danger"] }} /><b style={{ background: mapped.css["--warning"] }} /></span>
    </div>
  </div>;
}

/** `settings` with the theme in use for one slot replaced; no kind leaves both as they are. */
function withActive(settings: AppSettings, kind: "light" | "dark" | undefined, id: string | null): AppSettings {
  if (kind === "light") return { ...settings, lightVscodeTheme: id };
  if (kind === "dark") return { ...settings, darkVscodeTheme: id };
  return settings;
}

/** A call's result or its message; a plain function so the React Compiler need not handle try/catch. */
async function attempt<T>(task: () => Promise<T>): Promise<{ value: T } | { error: string }> {
  try { return { value: await task() }; } catch (reason) { return { error: formatUnknownError(reason) }; }
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

function downloads(count: number) {
  return count >= 1_000_000 ? `${(count / 1_000_000).toFixed(1)}M` : count >= 1_000 ? `${Math.round(count / 1_000)}k` : String(count);
}

function sourceLabel(theme: VsCodeTheme, t: ReturnType<typeof useTranslation>) {
  return theme.source.startsWith("open-vsx:") ? t("vscodeThemes.sourceOpenVsx", { name: theme.source.slice(9) }) : t("vscodeThemes.sourceLocal");
}

/** Settings → Appearance: search Open VSX or pick a file, preview, install, and choose the light and dark theme. */
export function VsCodeThemesGroup({ settings, onSave }: { settings: AppSettings; onSave: (settings: AppSettings) => void }) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("downloadCount");
  const [results, setResults] = useState<VsCodeThemeExtension[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, VsCodeTheme[] | "loading">>({});
  const ticket = useRef(0);
  const installed = settings.vscodeThemes;
  const activeId = { light: settings.lightVscodeTheme, dark: settings.darkVscodeTheme };

  const save = (themes: VsCodeTheme[], use?: VsCodeTheme) => onSave(withActive({ ...settings, vscodeThemes: themes }, use?.kind, use?.id ?? null));
  const add = (theme: VsCodeTheme, use: boolean) => {
    const exists = installed.some((item) => item.id === theme.id);
    if (!exists && installed.length >= MAX_INSTALLED_THEMES) { setError(t("vscodeThemes.full", { count: MAX_INSTALLED_THEMES })); return; }
    setError(null);
    save(exists ? installed.map((item) => (item.id === theme.id ? theme : item)) : [...installed, theme], use ? theme : undefined);
  };
  const remove = (theme: VsCodeTheme) => onSave({
    ...settings,
    vscodeThemes: installed.filter((item) => item.id !== theme.id),
    lightVscodeTheme: settings.lightVscodeTheme === theme.id ? null : settings.lightVscodeTheme,
    darkVscodeTheme: settings.darkVscodeTheme === theme.id ? null : settings.darkVscodeTheme,
  });
  const choose = (kind: "light" | "dark", id: string) => onSave(withActive(settings, kind, id === DEFAULT ? null : id));

  const search = async () => {
    const text = query.trim();
    if (!text) return;
    const mine = ++ticket.current;
    setSearching(true); setError(null);
    const outcome = await attempt(() => client.searchVsCodeThemes(text, sort));
    if (mine !== ticket.current) return;
    setSearching(false);
    setResults("value" in outcome ? outcome.value : null);
    if ("error" in outcome) setError(outcome.error);
  };
  const togglePreview = async (extension: VsCodeThemeExtension) => {
    const id = `${extension.namespace}.${extension.name}`;
    if (previews[id]) { setPreviews((previous) => withoutKey(previous, id)); return; }
    setPreviews((previous) => ({ ...previous, [id]: "loading" }));
    const outcome = await attempt(() => client.fetchVsCodeThemes(extension.namespace, extension.name));
    if ("error" in outcome) { setPreviews((previous) => withoutKey(previous, id)); setError(outcome.error); return; }
    setPreviews((previous) => (id in previous ? { ...previous, [id]: outcome.value } : previous));
  };
  const pickFile = async () => {
    setError(null);
    const outcome = await attempt(() => client.importVsCodeThemeFile());
    if ("error" in outcome) { setError(outcome.error); return; }
    const themes = outcome.value;
    if (!themes?.length) return;
    const merged = [...installed];
    for (const theme of themes) {
      const at = merged.findIndex((item) => item.id === theme.id);
      if (at >= 0) merged[at] = theme;
      else if (merged.length < MAX_INSTALLED_THEMES) merged.push(theme);
    }
    save(merged, themes.length === 1 ? themes[0] : undefined);
  };

  const options = (kind: "light" | "dark") => [{ value: DEFAULT, label: t("vscodeThemes.default") }, ...installed.filter((theme) => theme.kind === kind).map((theme) => ({ value: theme.id, label: theme.name }))];

  return <SettingsGroup title={t("vscodeThemes.title")} card>
    <SettingsRow title={t("vscodeThemes.light")} description={t("vscodeThemes.lightHelp")}>
      <Select className="general-settings-select" label={t("vscodeThemes.light")} value={activeId.light ?? DEFAULT} options={options("light")} onChange={(id) => choose("light", id)} />
    </SettingsRow>
    <SettingsRow title={t("vscodeThemes.dark")} description={t("vscodeThemes.darkHelp")}>
      <Select className="general-settings-select" label={t("vscodeThemes.dark")} value={activeId.dark ?? DEFAULT} options={options("dark")} onChange={(id) => choose("dark", id)} />
    </SettingsRow>
    <SettingsRow title={t("vscodeThemes.import")} description={t("vscodeThemes.importHelp")}>
      <InteractiveButton variant="secondary" glow={false} aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? <X size={14} aria-hidden="true" /> : <Search size={14} aria-hidden="true" />}{t(open ? "vscodeThemes.close" : "vscodeThemes.browse")}</InteractiveButton>
      <InteractiveButton variant="secondary" glow={false} onClick={() => void pickFile()}>{t("vscodeThemes.file")}</InteractiveButton>
    </SettingsRow>
    <AnimatePresence initial={false}>
      {open && <motion.div key="search" className="vscode-theme-panel" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }} style={{ overflow: "hidden" }}>
        <form className="vscode-theme-search" onSubmit={(event) => { event.preventDefault(); void search(); }}>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} placeholder={t("vscodeThemes.searchPlaceholder")} aria-label={t("vscodeThemes.searchLabel")} />
          <Select className="general-settings-select" label={t("vscodeThemes.sort")} value={sort} options={SORTS.map((value) => ({ value, label: t(`vscodeThemes.sort.${value}`) }))} onChange={setSort} />
          <InteractiveButton type="submit" variant="primary" glow={false} loading={searching} disabled={!query.trim()}>{t("vscodeThemes.search")}</InteractiveButton>
        </form>
        {searching && <p className="vscode-theme-note ui-caption text-text-muted">{t("vscodeThemes.searching")}</p>}
        {!searching && results?.length === 0 && <p className="vscode-theme-note ui-caption text-text-muted">{t("vscodeThemes.noResults")}</p>}
        <ul className="vscode-theme-results">
          {results?.map((extension) => {
            const id = `${extension.namespace}.${extension.name}`;
            const preview = previews[id];
            return <li key={id}>
              <div className="vscode-theme-result">
                {extension.iconUrl ? <img src={extension.iconUrl} alt="" width={32} height={32} loading="lazy" referrerPolicy="no-referrer" /> : <span className="vscode-theme-icon" aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                  <p className="ui-control truncate font-medium text-text-primary">{extension.displayName}</p>
                  <p className="ui-caption truncate text-text-muted">{extension.namespace} · {extension.license} · {t("vscodeThemes.downloads", { count: downloads(extension.downloadCount) })}</p>
                </div>
                <InteractiveButton variant="secondary" glow={false} loading={preview === "loading"} onClick={() => void togglePreview(extension)}>{t(preview && preview !== "loading" ? "vscodeThemes.hidePreview" : "vscodeThemes.preview")}</InteractiveButton>
              </div>
              <AnimatePresence initial={false}>
                {preview && preview !== "loading" && <motion.ul key="themes" className="vscode-theme-candidates" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }} style={{ overflow: "hidden" }}>
                  {preview.map((theme) => {
                    const has = installed.some((item) => item.id === theme.id);
                    const using = activeId[theme.kind] === theme.id;
                    return <li key={theme.id} className="vscode-theme-candidate">
                      <ThemePreview theme={theme} />
                      <div className="min-w-0 flex-1">
                        <p className="ui-control truncate text-text-primary">{theme.name}</p>
                        <p className="ui-caption text-text-muted">{t(`vscodeThemes.kind.${theme.kind}`)}</p>
                      </div>
                      {using ? <span className="vscode-theme-badge ui-caption"><Check size={12} aria-hidden="true" />{t("vscodeThemes.inUse")}</span> : <>
                        {!has && <InteractiveButton variant="secondary" glow={false} onClick={() => add(theme, false)}>{t("vscodeThemes.install")}</InteractiveButton>}
                        <InteractiveButton variant="primary" glow={false} onClick={() => add(theme, true)}>{t(has ? "vscodeThemes.use" : "vscodeThemes.installAndUse")}</InteractiveButton>
                      </>}
                    </li>;
                  })}
                </motion.ul>}
              </AnimatePresence>
            </li>;
          })}
        </ul>
      </motion.div>}
    </AnimatePresence>
    {error ? <p role="alert" className="px-4 pb-3 ui-caption text-danger">{error}</p> : null}
    {installed.length > 0 && <div className="vscode-theme-installed">
      <p className="ui-caption text-text-muted">{t("vscodeThemes.installed")}</p>
      <ul>
        {installed.map((theme) => {
          const using = activeId[theme.kind] === theme.id;
          return <li key={theme.id} className="vscode-theme-candidate">
            <ThemePreview theme={theme} />
            <div className="min-w-0 flex-1">
              <p className="ui-control truncate text-text-primary">{theme.name}</p>
              <p className="ui-caption truncate text-text-muted">{t(`vscodeThemes.kind.${theme.kind}`)} · {sourceLabel(theme, t)}</p>
            </div>
            {using ? <span className="vscode-theme-badge ui-caption"><Check size={12} aria-hidden="true" />{t("vscodeThemes.inUse")}</span> : <InteractiveButton variant="secondary" glow={false} onClick={() => choose(theme.kind, theme.id)}>{t("vscodeThemes.use")}</InteractiveButton>}
            <button type="button" className="vscode-theme-remove" aria-label={t("vscodeThemes.remove", { name: theme.name })} onClick={() => remove(theme)}><X size={14} aria-hidden="true" /></button>
          </li>;
        })}
      </ul>
    </div>}
  </SettingsGroup>;
}
