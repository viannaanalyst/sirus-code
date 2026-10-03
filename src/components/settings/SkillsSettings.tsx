import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Eye, RefreshCw, RotateCcw, Search } from "lucide-react";
import { client } from "@/client";
import type { AgentSkill, AppSettings, SkillSource } from "@/client/types";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { SettingsGroup, SettingsSection } from "./SettingsSection";
import { ProviderIcon } from "./ProviderIcon";
import { AGENT_PROVIDER_IDS } from "@/client/types";
import { PROVIDERS } from "@/lib/provider-registry";
import { filterSkills, skillSections, toggleSkill } from "@/lib/skills";
import { useSkillsCatalog } from "@/lib/use-skills-catalog";
import { formatUnknownError } from "@/lib/format-error";
import { useTranslation } from "@/i18n/use-translation";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { IconButton } from "@/primitives/IconButton";
import { Switch } from "@/primitives/Switch";
import { useAppStore } from "@/store/app-store";
import "@/styles/general-settings.css";
import "@/styles/keybindings.css";

export function SkillsSettings({ settings }: { settings: AppSettings }) {
  const t = useTranslation();
  const projectId = useAppStore(state => state.selectedProjectId);
  const sessionId = useAppStore(state => state.selectedSessionId);
  const owner = { projectId, sessionId };
  const { key, catalog, loading, error, refresh } = useSkillsCatalog(owner);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<{ name: string; path: string; document: string | null; error: string | null } | null>(null);
  const previewGeneration = useRef(0);
  const invalidatePreview = useCallback(() => { previewGeneration.current++; }, []);
  useEffect(() => { invalidatePreview(); setPreview(null); return invalidatePreview; }, [key, invalidatePreview]);
  const sourceLabel = (origin: string) => origin === "agents" ? t("skills.sharedOrigin") : origin === "switchyard" ? "Switchyard" : PROVIDERS.find(p => p.id === origin)?.name ?? origin;
  const openPreview = async (skill: AgentSkill, source: SkillSource) => {
    const generation = ++previewGeneration.current;
    setPreview({ name: skill.name, path: source.path, document: null, error: null });
    try {
      const document = await client.skillPreview(owner, source.id);
      if (generation === previewGeneration.current) setPreview({ name: skill.name, path: source.path, document, error: null });
    } catch (error) {
      if (generation === previewGeneration.current) setPreview({ name: skill.name, path: source.path, document: null, error: formatUnknownError(error) });
    }
  };
  const all = catalog?.skills ?? [];
  const sections = skillSections(filterSkills(all, query));
  const save = (name?: string, enabled?: boolean) => {
    const store = useAppStore.getState();
    void store.saveSettings(name ? toggleSkill(store.settings, name, Boolean(enabled)) : { ...store.settings, disabledSkills: [] });
  };
  return <SettingsSection title={t("skills.title")} description={t("skills.description")}
    headerAction={<InteractiveButton variant="secondary" glow={false} disabled={!settings.disabledSkills.length} onClick={() => save()}><RotateCcw size={14} aria-hidden="true" />{t("Restore defaults")}</InteractiveButton>}>
    <div className="general-settings">
    <SettingsGroup title={t("skills.portable")} card>
      <div className="settings-row flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="min-w-0 flex-1"><p className="ui-control font-medium">{t("skills.folder")}</p><p className="mt-1 ui-description text-text-muted">{t("skills.folderHelp")}</p>
          {catalog && <code className="selectable mt-2 block break-all ui-caption text-text-secondary">{catalog.portableDir}</code>}</div>
        <div aria-live="polite" className="shrink-0 text-right ui-caption text-text-muted"><p>{loading ? t("skills.loading") : t("skills.enabledCount").replace("{enabled}", String(all.filter(skill => !settings.disabledSkills.includes(skill.name)).length)).replace("{total}", String(all.length))}</p><p className="mt-1">{t("skills.countScope")}</p></div>
      </div>
    </SettingsGroup>
    <p className="keybinding-callout ui-description">{t("skills.catalogHelp")}</p>
    <div className="mb-5 flex items-center gap-2">
      <label className="keybinding-search mb-0 min-w-0 flex-1"><Search size={14} aria-hidden="true" className="text-text-muted" /><input aria-label={t("skills.search")} placeholder={t("skills.search")} value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent ui-control outline-none" /></label>
      <IconButton label={t("skills.refresh")} disabled={loading} onClick={() => void refresh()}><RefreshCw size={14} aria-hidden="true" /></IconButton>
    </div>
    {error && <p role="alert" className="mb-4 ui-control text-danger">{error}</p>}
    {loading && <p role="status" className="ui-control text-text-muted">{t("skills.loading")}</p>}
    {catalog?.truncated && <p role="status" className="mb-4 ui-caption text-text-muted">{t("skills.truncated")}</p>}
    {!loading && !error && !all.length && <div className="rounded-[var(--radius-lg)] border border-border-subtle p-6"><p className="ui-control">{t("skills.empty")}</p><p className="mt-1 ui-description text-text-muted">{t("skills.emptyHelp")}</p></div>}
    {!loading && all.length > 0 && !sections.length && <p role="status" className="ui-control text-text-muted">{t("skills.noMatch")}</p>}
    {sections.map(([origin, skills]) => <SettingsGroup key={origin} title={origin === "shared" ? t("skills.shared") : origin === "project" ? t("skills.project") : sourceLabel(origin)} card>
      {skills.map(skill => <div key={skill.name} className="settings-row flex items-start gap-4 border-b border-border-subtle py-3 last:border-b-0">
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => void openPreview(skill, skill.sources[0])} className="inline-flex max-w-full items-center gap-1.5 text-left ui-control font-medium hover:text-text-secondary"><Box size={14} aria-hidden="true" className="shrink-0 text-text-muted" /><span className="truncate">{skill.name}</span></button>
          <p className="mt-1 ui-description text-text-muted">{skill.description || t("skills.noDescription")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 ui-caption text-text-muted">
            <span>{t("skills.origin")}:</span>
            {[...new Set(skill.sources.map(source => source.origin))].map(origin => <span key={origin} className="inline-flex items-center gap-1">{AGENT_PROVIDER_IDS.some(id => id === origin) && <ProviderIcon id={origin as typeof AGENT_PROVIDER_IDS[number]} size={12} />}{sourceLabel(origin)}</span>)}
          </div>
          <details className="mt-1.5 ui-caption text-text-muted"><summary className="cursor-pointer">{t("skills.sources")} · {skill.sources.length}</summary><div className="mt-2 space-y-1.5">
            {skill.sources.map(source => <button type="button" key={source.id} aria-label={`${t("skills.preview")} · ${skill.name} · ${sourceLabel(source.origin)}`} onClick={() => void openPreview(skill, source)} className="flex w-full min-w-0 items-center gap-1.5 rounded py-0.5 text-left hover:text-text-primary"><Eye size={12} aria-hidden="true" className="shrink-0" /><code className="truncate">{source.path}</code></button>)}
          </div></details>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1"><IconButton label={`${t("skills.preview")} · ${skill.name}`} onClick={() => void openPreview(skill, skill.sources[0])} className="size-6 min-h-0 p-0"><Eye size={13} aria-hidden="true" /></IconButton><Switch checked={!settings.disabledSkills.includes(skill.name)} onChange={enabled => save(skill.name, enabled)} label={`${t("skills.enable")} · ${skill.name}`} /></div>
      </div>)}
    </SettingsGroup>)}
    </div>
    <Dialog open={preview !== null} onOpenChange={open => { if (!open) { previewGeneration.current++; setPreview(null); } }}>
      <DialogContent title={preview?.name ?? t("skills.preview")} description={t("skills.previewHelp")} className="w-[min(740px,calc(100vw-32px))]">
        <code className="selectable block break-all ui-caption text-text-muted">{preview?.path}</code>
        {preview?.error ? <p role="alert" className="text-danger ui-control">{preview.error}</p> : preview?.document === null ? <p role="status">{t("common.loading")}</p> : <pre className="scroll-thin selectable mt-3 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-border-subtle bg-background-1 p-4 font-[family-name:var(--code-font-family)] text-[length:var(--code-font-size)]">{preview?.document}</pre>}
      </DialogContent>
    </Dialog>
  </SettingsSection>;
}
