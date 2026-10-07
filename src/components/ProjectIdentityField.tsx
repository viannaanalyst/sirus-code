import { useEffect, useRef, useState } from "react";
import type { AstroIconId, AstroStyle, Project } from "@/client/types";
import { AstroIcon } from "@/components/astros/AstroArt";
import { ImagePlus, Search, Trash2 } from "@/components/icons/phosphor";
import { COLOR_ORDER, EMOJIS } from "@/components/ProjectLookEditor";
import { ProjectGlyph, PROJECT_COLORS, projectColor } from "@/components/ProjectGlyph";
import { useTranslation } from "@/i18n/use-translation";
import { ASTRO_ICONS, ASTRO_STYLES } from "@/lib/astro-art";
import { cn } from "@/lib/cn";
import { PROJECT_ICONS, searchProjectIcons } from "@/lib/project-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { useAppStore } from "@/store/app-store";
import "@/styles/astros.css";

type Tab = "emoji" | "icons" | "astros";

/**
 * The project's name with its icon beside it (after Synara): the icon opens one picker
 * with Emoji, Icons and Astros (Metal or Neon) tabs, the colours, a search and a logo
 * image. Each icon change applies at once; the name saves with the dialog.
 */
export function ProjectIdentityField({ projectId, name, onName, disabled }: { projectId: string; name: string; onName: (name: string) => void; disabled?: boolean }) {
  const t = useTranslation();
  const project = useAppStore((state) => state.projects.find((row) => row.id === projectId));
  const update = useAppStore((state) => state.updateProjectLook);
  const look = project?.look ?? {};
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(look.astro ? "astros" : look.icon ? "icons" : "emoji");
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useState("");
  const [astroStyle, setAstroStyle] = useState<AstroStyle>(look.astro?.style ?? "metal");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (!project) return null;
  const run = (action: Parameters<typeof update>[0]) => { setBusy(true); void update(action).finally(() => setBusy(false)); };
  const tint = projectColor(look);
  const custom = look.color && !PROJECT_COLORS[look.color] ? look.color : null;
  const hasIcon = Boolean(look.logo || look.emoji || look.astro || look.icon);
  const clearIcon = () => {
    if (look.logo) run({ type: "clearLogo", projectId });
    else if (look.emoji) run({ type: "setEmoji", projectId, emoji: null });
    else if (look.astro) run({ type: "setAstro", projectId, astro: null });
    else if (look.icon) run({ type: "setIcon", projectId, icon: null });
  };
  const setAstro = (icon: AstroIconId, style: AstroStyle) => run({ type: "setAstro", projectId, astro: { icon, style } });
  const icons = searchProjectIcons(query);
  const astros = ASTRO_ICONS.filter((icon) => !query.trim() || t(`astros.icon.${icon}`).toLowerCase().includes(query.trim().toLowerCase()));

  return <div className="project-identity">
    <span className="project-identity-label ui-control">{t("Project name")}</span>
    <div className="project-identity-field">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="project-identity-icon" disabled={disabled} aria-label={t("projectLook.chooseIcon")} aria-expanded={open}>
            <ProjectGlyph project={project as Project} size={18} />
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" sideOffset={8} className="project-identity-picker" aria-label={t("projectLook.chooseIcon")}>
          <div className="project-identity-tabs" role="tablist">
            {(["emoji", "icons", "astros"] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>{t(`projectLook.tab.${item}`)}</button>)}
          </div>
          {tab === "emoji" ? <form className="project-identity-search" onSubmit={(event) => { event.preventDefault(); if (typed.trim()) run({ type: "setEmoji", projectId, emoji: typed.trim() }); setTyped(""); }}>
            <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={t("projectLook.typeEmoji")} aria-label={t("projectLook.typeEmoji")} maxLength={16} />
          </form> : <label className="project-identity-search">
            <Search size={13} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(tab === "icons" ? "projectLook.searchIcons" : "projectLook.searchAstros")} aria-label={t(tab === "icons" ? "projectLook.searchIcons" : "projectLook.searchAstros")} />
          </label>}
          {tab === "astros" ? <div className="astro-segmented project-identity-styles" role="group" aria-label={t("astros.style")}>
            {ASTRO_STYLES.map((option) => <button key={option} type="button" aria-pressed={astroStyle === option} onClick={() => { setAstroStyle(option); if (look.astro) setAstro(look.astro.icon, option); }}>{t(`astros.style.${option}`)}</button>)}
          </div> : null}
          <div className="project-identity-colors" role="radiogroup" aria-label={t("projectLook.color")}>
            <button type="button" role="radio" aria-checked={!look.color} aria-label={t("projectLook.defaultColor")} className="project-look-swatch" style={{ background: PROJECT_COLORS.gray }} onClick={() => run({ type: "setColor", projectId, color: null })} />
            {COLOR_ORDER.map((id) => <button key={id} type="button" role="radio" aria-checked={look.color === id} aria-label={t(`projectLook.colors.${id}`)} className="project-look-swatch" style={{ background: PROJECT_COLORS[id] }} onClick={() => run({ type: "setColor", projectId, color: id })} />)}
            <label className={cn("project-look-swatch project-look-custom", custom && "project-look-custom-on")} aria-label={t("projectLook.customColor")} style={custom ? { background: custom } : undefined}>
              <input type="color" value={custom ?? "#888888"} aria-label={t("projectLook.customColor")} onChange={(event) => {
                const value = event.target.value;
                // The system colour panel reports every move; save once it settles.
                if (timer.current) clearTimeout(timer.current);
                timer.current = setTimeout(() => run({ type: "setColor", projectId, color: value }), 300);
              }} />
            </label>
          </div>
          <div className="scroll-thin project-identity-grid" role="radiogroup" aria-label={t(`projectLook.tab.${tab}`)}>
            {tab === "emoji" ? EMOJIS.map((emoji) => <button key={emoji} type="button" role="radio" aria-checked={look.emoji === emoji} aria-label={emoji} disabled={busy} onClick={() => run({ type: "setEmoji", projectId, emoji })}><span className="project-identity-emoji">{emoji}</span></button>)
              : tab === "icons" ? icons.map((icon) => { const Glyph = PROJECT_ICONS[icon].Icon; return <button key={icon} type="button" role="radio" aria-checked={look.icon === icon} aria-label={icon} title={icon} disabled={busy} onClick={() => run({ type: "setIcon", projectId, icon })}><Glyph size={18} style={{ color: tint ?? "var(--text-secondary)" }} /></button>; })
              : astros.map((icon) => <button key={icon} type="button" role="radio" aria-checked={look.astro?.icon === icon} aria-label={t(`astros.icon.${icon}`)} title={t(`astros.icon.${icon}`)} disabled={busy} onClick={() => setAstro(icon, astroStyle)}><AstroIcon icon={icon} style={astroStyle} color={tint ?? "#8c9bff"} size={26} /></button>)}
            {tab !== "emoji" && !(tab === "icons" ? icons : astros).length ? <p className="project-identity-empty ui-caption">{t("projectLook.noMatch")}</p> : null}
          </div>
          <div className="project-identity-footer">
            <button type="button" className="project-look-chip ui-caption" disabled={busy} onClick={() => run({ type: "pickLogo", projectId })}><ImagePlus size={12} aria-hidden="true" />{t("projectLook.useImage")}</button>
            {hasIcon ? <button type="button" className="project-look-chip ui-caption" disabled={busy} onClick={clearIcon}><Trash2 size={12} aria-hidden="true" />{t("projectLook.removeIcon")}</button> : null}
          </div>
        </PopoverContent>
      </Popover>
      <input className="project-identity-input ui-control" autoFocus required maxLength={200} value={name} disabled={disabled} aria-label={t("Project name")} onChange={(event) => onName(event.target.value)} />
    </div>
  </div>;
}
