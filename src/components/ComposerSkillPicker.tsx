import { useState } from "react";
import { Box, RefreshCw, Search } from "@/components/icons/phosphor";
import { useAppStore } from "@/store/app-store";
import { useSkillsCatalog } from "@/lib/use-skills-catalog";
import { filterSkills, insertSkillInvocation } from "@/lib/skills";
import { useTranslation } from "@/i18n/use-translation";

export function ComposerSkillPicker({ owner, onSelect, unavailable = false }: { owner: string; onSelect: () => void; unavailable?: boolean }) {
  const t = useTranslation();
  const [query, setQuery] = useState("");
  const sessionId = owner.startsWith("session:") ? owner.slice(8) : null;
  const projectId = owner.startsWith("project:") ? owner.slice(8) : null;
  const { catalog, loading, error, refresh } = useSkillsCatalog({ projectId, sessionId });
  const disabled = useAppStore(state => state.settings.disabledSkills);
  const skills = filterSkills(catalog?.skills ?? [], query, disabled, true);
  return <div className="px-2 pb-2">
    <p className="mb-2 px-1 ui-description text-text-muted">{t("skills.useHelp")}</p>
    <div className="mb-2 flex items-center gap-2"><label className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-[var(--radius-md)] border border-border-default bg-background-1 px-2"><Search size={13} aria-hidden="true" className="text-text-muted" /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} aria-label={t("skills.search")} placeholder={t("skills.search")} className="min-w-0 flex-1 bg-transparent ui-control outline-none" /></label><button type="button" aria-label={t("skills.refresh")} disabled={loading} onClick={() => void refresh()} className="rounded p-1 text-text-muted hover:text-text-primary disabled:opacity-40"><RefreshCw size={14} /></button></div>
    {loading ? <p role="status" className="p-2 ui-caption text-text-muted">{t("skills.loading")}</p> : error ? <p role="alert" className="p-2 ui-caption text-danger">{error}</p> : <div className="scroll-thin max-h-64 overflow-y-auto">
      {!skills.length && <p role="status" className="p-2 ui-caption text-text-muted">{t(catalog?.skills.length ? "skills.noMatch" : "skills.empty")}</p>}
      {skills.map(skill => <button key={skill.name} type="button" disabled={unavailable} className="flex w-full items-start gap-2 rounded-[var(--radius-md)] px-2 py-2 text-left hover:bg-background-3 focus-visible:bg-background-3 disabled:opacity-40" onClick={() => {
        const store = useAppStore.getState();
        store.setComposerDraft(owner, insertSkillInvocation(store.composerDrafts[owner] ?? "", skill.name)); onSelect();
      }}><Box size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-text-muted" /><span className="min-w-0"><span className="block truncate ui-control">{skill.name}</span><span className="mt-0.5 line-clamp-2 block ui-description text-text-muted">{skill.description || t("skills.noDescription")}</span></span></button>)}
    </div>}
  </div>;
}
