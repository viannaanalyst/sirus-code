import { useState } from "react";
import type { Astro, AstroBackground, AstroIconId, AstroInput, AstroStyle } from "@/client/types";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { AstroBackdrop, AstroIcon } from "@/components/astros/AstroArt";
import { useTranslation } from "@/i18n/use-translation";
import { ASTRO_BACKGROUNDS, ASTRO_COLORS, ASTRO_ICONS, ASTRO_STYLES } from "@/lib/astro-art";
import { cn } from "@/lib/cn";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { useAppStore } from "@/store/app-store";

const blank = (projectId: string | null): AstroInput => ({ id: null, name: "", icon: "galaxia", style: "metal", color: ASTRO_COLORS[0], background: "nebulosa", projectIds: projectId ? [projectId] : [], soul: "" });

/** Create or edit an Astro: identity, look, projects and soul, with a live preview. */
export function AstroDialog({ open, editing, onClose }: { open: boolean; editing: Astro | null; onClose: () => void }) {
  const t = useTranslation();
  const projects = useAppStore((state) => state.projects);
  const selectedProjectId = useAppStore((state) => state.selectedProjectId);
  const [draft, setDraft] = useState<AstroInput>(() => blank(selectedProjectId));
  const [busy, setBusy] = useState(false);
  // The draft resets only when the dialog opens or switches Astro, never when the list reloads.
  const editingId = editing?.id ?? null;
  const [opened, setOpened] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  if (opened.open !== open || opened.id !== editingId) {
    setOpened({ open, id: editingId });
    if (open) setDraft(editing ? { id: editing.id, name: editing.name, icon: editing.icon, style: editing.style, color: editing.color, background: editing.background, projectIds: editing.projectIds, soul: editing.soul } : blank(selectedProjectId ?? projects[0]?.id ?? null));
  }
  const patch = (next: Partial<AstroInput>) => setDraft((current) => ({ ...current, ...next }));
  const valid = draft.name.trim().length > 0 && draft.projectIds.length > 0;
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const store = useAppStore.getState();
    const saved = await store.saveAstro({ ...draft, name: draft.name.trim() });
    setBusy(false);
    if (!saved) return;
    onClose();
    if (!editing) void store.openAstro(saved.id);
  };
  const label = "ui-caption text-text-muted";
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
    <DialogContent title={editing ? t("astros.edit", { name: editing.name }) : t("astros.new")} description={t("astros.dialogHint")} className="w-[min(860px,calc(100vw-32px))]">
      <div className="astro-dialog" style={{ "--astro": draft.color } as React.CSSProperties}>
        <aside className="astro-dialog-preview">
          <AstroBackdrop background={draft.background} color={draft.color} />
          <div className="astro-dialog-avatar"><AstroIcon icon={draft.icon} style={draft.style} color={draft.color} size={96} /></div>
          <p className="relative ui-section text-text-primary">{draft.name.trim() || t("astros.namePlaceholder")}</p>
        </aside>
        <div className="scroll-thin flex max-h-[68vh] min-w-0 flex-col gap-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <label className="flex flex-col gap-1.5"><span className={label}>{t("astros.name")}</span>
              <input className="automation-control ui-control" value={draft.name} maxLength={40} autoFocus placeholder={t("astros.namePlaceholder")} onChange={(event) => patch({ name: event.target.value })} /></label>
            <div className="flex flex-col gap-1.5"><span className={label}>{t("astros.style")}</span>
              <div className="astro-segmented" role="group" aria-label={t("astros.style")}>
                {ASTRO_STYLES.map((style: AstroStyle) => <button key={style} type="button" aria-pressed={draft.style === style} onClick={() => patch({ style })}>{t(`astros.style.${style}`)}</button>)}
              </div></div>
          </div>
          <div className="flex flex-col gap-1.5"><span className={label}>{t("astros.icon")}</span>
            <div className="astro-icon-grid" role="radiogroup" aria-label={t("astros.icon")}>
              {ASTRO_ICONS.map((icon: AstroIconId) => <button key={icon} type="button" role="radio" aria-checked={draft.icon === icon} className="astro-icon-cell" onClick={() => patch({ icon })}>
                <AstroIcon icon={icon} style={draft.style} color={draft.color} size={40} /><span className="ui-caption">{t(`astros.icon.${icon}`)}</span>
              </button>)}
            </div></div>
          <div className="flex flex-col gap-1.5"><span className={label}>{t("astros.color")}</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("astros.color")}>
              {ASTRO_COLORS.map((color) => <button key={color} type="button" role="radio" aria-checked={draft.color === color} aria-label={color} className="astro-swatch" style={{ background: color }} onClick={() => patch({ color })} />)}
            </div></div>
          <div className="flex flex-col gap-1.5"><span className={label}>{t("astros.background")}</span>
            <div className="astro-background-grid" role="radiogroup" aria-label={t("astros.background")}>
              {ASTRO_BACKGROUNDS.map((background: AstroBackground) => <button key={background} type="button" role="radio" aria-checked={draft.background === background} className="astro-background-cell" onClick={() => patch({ background })}>
                <AstroBackdrop background={background} color={draft.color} /><span className="relative ui-caption">{t(`astros.bg.${background}`)}</span>
              </button>)}
            </div></div>
          <div className="flex flex-col gap-1.5"><span className={label}>{t("astros.projects")}</span>
            <div className="flex flex-wrap gap-1.5">
              {projects.map((project) => {
                const on = draft.projectIds.includes(project.id);
                return <button key={project.id} type="button" aria-pressed={on} className={cn("astro-chip ui-control", on && "astro-chip-on")}
                  onClick={() => patch({ projectIds: on ? draft.projectIds.filter((id) => id !== project.id) : [...draft.projectIds, project.id] })}>{project.name}</button>;
              })}
            </div>
            <span className={label}>{t("astros.projectsHint")}</span></div>
          <label className="flex flex-col gap-1.5"><span className={label}>{t("astros.soul")}</span>
            <textarea className="automation-control ui-control min-h-[140px] resize-y py-2 font-mono" value={draft.soul} maxLength={16000} spellCheck={false} placeholder={t("astros.soulPlaceholder")} onChange={(event) => patch({ soul: event.target.value })} />
            <span className={label}>{t("astros.soulHint")}</span></label>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <InteractiveButton variant="ghost" disabled={busy} onClick={onClose}>{t("common.cancel")}</InteractiveButton>
        <InteractiveButton loading={busy} disabled={!valid} onClick={() => void save()}>{t(editing ? "astros.save" : "astros.create")}</InteractiveButton>
      </div>
    </DialogContent>
  </Dialog>;
}
