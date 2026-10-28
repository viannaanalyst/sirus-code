import { useEffect, useRef, useState, type ReactNode, type WheelEvent } from "react";
import type { AstroIconId, AstroStyle, ProjectLook } from "@/client/types";
import type { LookChange } from "@/lib/project-folders";
import { ImagePlus, Search, Trash2 } from "@/components/icons/phosphor";
import { AstroIcon } from "@/components/AstroIcon";
import { COLOR_ORDER, EMOJIS } from "@/components/ProjectLookEditor";
import { ProjectIcon } from "@/components/ProjectAvatar";
import { PROJECT_COLORS, projectColor } from "@/components/ProjectGlyph";
import { useTranslation } from "@/i18n/use-translation";
import { ASTRO_DEFAULT_COLOR, ASTRO_ICONS, ASTRO_STYLES } from "@/lib/astro-art";
import { cn } from "@/lib/cn";
import { PROJECT_ICONS, searchProjectIcons } from "@/lib/project-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { useAppStore } from "@/store/app-store";

type Tab = "emoji" | "icons" | "astros";

export type LookPick = LookChange | { kind: "pickImage" };

/** The project's name with its avatar beside it; the avatar's look is edited from the sidebar (ADR-175). Saves with the dialog. */
export function ProjectIdentityField({ projectId, name, onName, disabled }: { projectId: string; name: string; onName: (name: string) => void; disabled?: boolean }) {
  const t = useTranslation();
  const project = useAppStore((state) => state.projects.find((row) => row.id === projectId));
  if (!project) return null;
  return <div className="project-identity">
    <span className="project-identity-label ui-control">{t("Project name")}</span>
    <div className="project-identity-field">
      <span className="project-identity-icon" aria-hidden="true"><ProjectIcon project={project} size={24} animated={false} /></span>
      <input className="project-identity-input ui-control" autoFocus required maxLength={200} value={name} disabled={disabled} aria-label={t("Project name")} onChange={(event) => onName(event.target.value)} />
    </div>
  </div>;
}

/**
 * The picker opens in a portal over a dialog, whose scroll lock cancels wheel scrolling outside
 * the dialog, so the grid only scrolled by its bar. When a wheel did not move the grid, it is
 * scrolled here; when the browser already scrolled it, nothing is added.
 */
function scrollBlockedWheel(event: WheelEvent<HTMLDivElement>) {
  const grid = event.currentTarget, before = grid.scrollTop, delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  requestAnimationFrame(() => { if (grid.scrollTop === before) grid.scrollTop = before + delta; });
}

/** The icon button and its picker, shared by projects and project folders. */
export function LookPicker({ look, glyph, busy = false, disabled, onPick }: { look: ProjectLook; glyph: ReactNode; busy?: boolean; disabled?: boolean; onPick: (change: LookPick) => void }) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(look.astro ? "astros" : look.icon ? "icons" : "emoji");
  const [astroStyle, setAstroStyle] = useState<AstroStyle>(look.astro?.style ?? "metal");
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const tint = projectColor(look);
  const custom = look.color && !PROJECT_COLORS[look.color] ? look.color : null;
  const hasIcon = Boolean(look.logo || look.emoji || look.astro || look.icon);
  const setAstro = (icon: AstroIconId, style: AstroStyle) => onPick({ kind: "astro", astro: { icon, style } });
  const icons = searchProjectIcons(query);
  const astros = ASTRO_ICONS.filter((icon) => !query.trim() || t(`astros.icon.${icon}`).toLowerCase().includes(query.trim().toLowerCase()));

  return <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="project-identity-icon" disabled={disabled} aria-label={t("projectLook.chooseIcon")} aria-expanded={open}>
            {glyph}
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" sideOffset={8} className="project-identity-picker" aria-label={t("projectLook.chooseIcon")}>
          <div className="project-identity-tabs" role="tablist">
            {(["emoji", "icons", "astros"] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>{t(`projectLook.tab.${item}`)}</button>)}
          </div>
          {tab === "emoji" ? <form className="project-identity-search" onSubmit={(event) => { event.preventDefault(); if (typed.trim()) onPick({ kind: "emoji", emoji: typed.trim() }); setTyped(""); }}>
            <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={t("projectLook.typeEmoji")} aria-label={t("projectLook.typeEmoji")} maxLength={16} />
          </form> : <label className="project-identity-search">
            <Search size={13} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(tab === "icons" ? "projectLook.searchIcons" : "projectLook.searchAstros")} aria-label={t(tab === "icons" ? "projectLook.searchIcons" : "projectLook.searchAstros")} />
          </label>}
          {tab === "astros" ? <div className="astro-segmented project-identity-styles" role="group" aria-label={t("astros.style")}>
            {ASTRO_STYLES.map((option) => <button key={option} type="button" aria-pressed={astroStyle === option} onClick={() => { setAstroStyle(option); if (look.astro) setAstro(look.astro.icon, option); }}>{t(`astros.style.${option}`)}</button>)}
          </div> : null}
          <div className="project-identity-colors" role="radiogroup" aria-label={t("projectLook.color")}>
            <button type="button" role="radio" aria-checked={!look.color} aria-label={t("projectLook.defaultColor")} className="project-look-swatch" style={{ background: PROJECT_COLORS.gray }} onClick={() => onPick({ kind: "color", color: null })} />
            {COLOR_ORDER.map((id) => <button key={id} type="button" role="radio" aria-checked={look.color === id} aria-label={t(`projectLook.colors.${id}`)} className="project-look-swatch" style={{ background: PROJECT_COLORS[id] }} onClick={() => onPick({ kind: "color", color: id })} />)}
            <label className={cn("project-look-swatch project-look-custom", custom && "project-look-custom-on")} aria-label={t("projectLook.customColor")} style={custom ? { background: custom } : undefined}>
              <input type="color" value={custom ?? "#888888"} aria-label={t("projectLook.customColor")} onChange={(event) => {
                const value = event.target.value;
                // The system colour panel reports every move; save once it settles.
                if (timer.current) clearTimeout(timer.current);
                timer.current = setTimeout(() => onPick({ kind: "color", color: value }), 300);
              }} />
            </label>
          </div>
          <div className="scroll-thin project-identity-grid" role="radiogroup" aria-label={t(`projectLook.tab.${tab}`)} onWheel={scrollBlockedWheel}>
            {tab === "emoji" ? EMOJIS.map((emoji) => <button key={emoji} type="button" role="radio" aria-checked={look.emoji === emoji} aria-label={emoji} disabled={busy} onClick={() => onPick({ kind: "emoji", emoji })}><span className="project-identity-emoji">{emoji}</span></button>)
              : tab === "icons" ? icons.map((icon) => { const Glyph = PROJECT_ICONS[icon].Icon; return <button key={icon} type="button" role="radio" aria-checked={look.icon === icon} aria-label={icon} title={icon} disabled={busy} onClick={() => onPick({ kind: "icon", icon })}><Glyph size={18} style={{ color: tint ?? "var(--text-secondary)" }} /></button>; })
              : astros.map((icon) => <button key={icon} type="button" role="radio" aria-checked={look.astro?.icon === icon} aria-label={t(`astros.icon.${icon}`)} title={t(`astros.icon.${icon}`)} disabled={busy} onClick={() => setAstro(icon, astroStyle)}><AstroIcon icon={icon} style={astroStyle} color={tint ?? ASTRO_DEFAULT_COLOR} size={26} /></button>)}
            {tab !== "emoji" && !(tab === "icons" ? icons : astros).length ? <p className="project-identity-empty ui-caption">{t("projectLook.noMatch")}</p> : null}
          </div>
          <div className="project-identity-footer">
            <button type="button" className="project-look-chip ui-caption" disabled={busy} onClick={() => onPick({ kind: "pickImage" })}><ImagePlus size={12} aria-hidden="true" />{t("projectLook.useImage")}</button>
            {hasIcon ? <button type="button" className="project-look-chip ui-caption" disabled={busy} onClick={() => onPick({ kind: "clear" })}><Trash2 size={12} aria-hidden="true" />{t("projectLook.removeIcon")}</button> : null}
          </div>
        </PopoverContent>
      </Popover>;
}
