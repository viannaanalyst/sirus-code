import { useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "@/client/types";
import { ProjectAvatar } from "@/components/ProjectAvatar";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";
import { AVATAR_EYES, AVATAR_MOUTHS, AVATAR_SWATCHES, resolveLook, shuffleLook, type AvatarLook } from "@/lib/project-avatar";
import { Popover, PopoverAnchor, PopoverContent } from "@/primitives/Popover";
import { useAppStore } from "@/store/app-store";

/** Saves land this long after the last change, so dragging in the colour picker is one write. */
const SAVE_DELAY_MS = 250;

/** Where the popover opens: next to the project's avatar when it is on screen, else near the sidebar's top. */
export function avatarAnchor(projectId: string): { getBoundingClientRect: () => DOMRect } {
  return { getBoundingClientRect: () => {
    const node = document.querySelector(`[data-project-avatar="${CSS.escape(projectId)}"]`);
    return node ? node.getBoundingClientRect() : new DOMRect(24, 140, 24, 24);
  } };
}

/**
 * The "Appearance" popover (ADR-175): colour (12 swatches and a free picker), eyes, mouth, cheeks,
 * Shuffle and Reset to default. Changes show at once and are saved to the project a moment later.
 * It stays mounted while it fades out, so `project` must outlive `open`.
 */
export function ProjectAppearancePopover({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslation();
  const anchor = useMemo(() => ({ current: avatarAnchor(project.id) }), [project.id]);
  const [look, setLook] = useState<AvatarLook>(() => resolveLook(project.name, project.appearance));
  const timer = useRef(0);
  const pending = useRef<AvatarLook | null | undefined>(undefined);
  // A fresh open starts from what is saved.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) setLook(resolveLook(project.name, project.appearance));
    wasOpen.current = open;
  }, [open, project.name, project.appearance]);

  const flush = () => {
    window.clearTimeout(timer.current);
    if (pending.current === undefined) return;
    const next = pending.current;
    pending.current = undefined;
    void useAppStore.getState().setProjectAppearance(project.id, next);
  };
  const save = (next: AvatarLook | null, now = false) => {
    pending.current = next;
    window.clearTimeout(timer.current);
    if (now) flush(); else timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
  };
  // Closing (or unmounting) saves what is waiting.
  useEffect(() => { if (!open) flush(); });
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (patch: Partial<AvatarLook>, now = true) => { const next = { ...look, ...patch }; setLook(next); save(next, now); };
  const swatch = AVATAR_SWATCHES.find((value) => value === look.color);

  return <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverAnchor virtualRef={anchor} />
    <PopoverContent side="bottom" align="start" sideOffset={6} className="project-appearance" aria-label={t("avatar.title")} onOpenAutoFocus={(event) => event.preventDefault()}>
      <h4 className="project-appearance-head"><ProjectAvatar name={project.name} look={look} animated={false} scale={2} /><span>{project.name}</span></h4>
      <div className="project-appearance-label">{t("avatar.color")}</div>
      <div className="project-appearance-swatches" role="radiogroup" aria-label={t("avatar.color")}>
        {AVATAR_SWATCHES.map((value) => <button key={value} type="button" role="radio" aria-checked={look.color === value} aria-label={value} className={cn(look.color === value && "is-on")} style={{ background: value }} onClick={() => change({ color: value })} />)}
        <input type="color" value={look.color} aria-label={t("avatar.customColor")} title={t("avatar.customColor")} data-custom={swatch ? undefined : ""} onChange={(event) => change({ color: event.target.value.toLowerCase() }, false)} />
      </div>
      <div className="project-appearance-label">{t("avatar.eyes")}</div>
      <div className="project-appearance-options" role="radiogroup" aria-label={t("avatar.eyes")}>
        {AVATAR_EYES.map((value) => <button key={value} type="button" role="radio" aria-checked={look.eyes === value} aria-label={t(`avatar.eyes.${value}`)} title={t(`avatar.eyes.${value}`)} className={cn(look.eyes === value && "is-on")} onClick={() => change({ eyes: value })}>
          <ProjectAvatar name={project.name} look={{ ...look, eyes: value }} animated={false} scale={2} />
        </button>)}
      </div>
      <div className="project-appearance-label">{t("avatar.mouth")}</div>
      <div className="project-appearance-options" role="radiogroup" aria-label={t("avatar.mouth")}>
        {AVATAR_MOUTHS.map((value) => <button key={value} type="button" role="radio" aria-checked={look.mouth === value} aria-label={t(`avatar.mouth.${value}`)} title={t(`avatar.mouth.${value}`)} className={cn(look.mouth === value && "is-on")} onClick={() => change({ mouth: value })}>
          <ProjectAvatar name={project.name} look={{ ...look, mouth: value }} animated={false} scale={2} />
        </button>)}
      </div>
      <label className="project-appearance-check"><input type="checkbox" checked={look.cheeks} onChange={(event) => change({ cheeks: event.target.checked })} /><span>{t("avatar.cheeks")}</span></label>
      <div className="project-appearance-actions">
        <button type="button" onClick={() => { const next = shuffleLook(); setLook(next); save(next, true); }}>{t("avatar.shuffle")}</button>
        <button type="button" onClick={() => { setLook(resolveLook(project.name, null)); save(null, true); }}>{t("avatar.reset")}</button>
      </div>
    </PopoverContent>
  </Popover>;
}
