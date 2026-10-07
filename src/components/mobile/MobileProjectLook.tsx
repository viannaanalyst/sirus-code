import { useState } from "react";
import type { AstroIconId, AstroStyle } from "@/client/types";
import { AstroIcon } from "@/components/astros/AstroArt";
import { X } from "@/components/icons/phosphor";
import { COLOR_ORDER, EMOJIS } from "@/components/ProjectLookEditor";
import { PROJECT_COLORS, ProjectGlyph, projectColor } from "@/components/ProjectGlyph";
import { useTranslation } from "@/i18n/use-translation";
import { ASTRO_ICONS, ASTRO_STYLES } from "@/lib/astro-art";
import { useAppStore } from "@/store/app-store";
import type { MobileNavigation } from "./MobileApp";
import "@/styles/astros.css";

/**
 * A project's icon from the phone (ADR-086): an Astro icon in Metal or Neon, an emoji,
 * and the folder colour. Each choice applies at once, as on the Mac. A logo file is
 * picked on the Mac only, since its picker opens there.
 */
export function MobileProjectLook({ projectId, navigation }: { projectId: string; navigation: MobileNavigation }) {
  const t = useTranslation();
  const project = useAppStore((state) => state.projects.find((item) => item.id === projectId));
  const update = useAppStore((state) => state.updateProjectLook);
  const [style, setStyle] = useState<AstroStyle>(project?.look?.astro?.style ?? "metal");
  if (!project) return null;
  const look = project.look ?? {};
  const tint = projectColor(look) ?? "#8c9bff";
  const setAstro = (icon: AstroIconId | null, next = style) => void update({ type: "setAstro", projectId, astro: icon ? { icon, style: next } : null });

  return <div className="mobile-page mobile-sheet">
    <span className="mobile-sheet-grip" aria-hidden="true" />
    <header className="mobile-sheet-head">
      <button type="button" className="mobile-sheet-close mobile-glass" aria-label={t("mobile.cancel")} onClick={navigation.back}><X size={17} aria-hidden="true" /></button>
      <h1>{t("mobile.projectIcon")}</h1>
      <span />
    </header>
    <div className="mobile-scroll mobile-form">
      <div className="mobile-look-preview"><ProjectGlyph project={project} size={44} /><span>{project.name}</span></div>
      <section>
        <h2>{t("projectLook.astro")}</h2>
        <div className="mobile-segmented" role="radiogroup" aria-label={t("astros.style")}>
          {ASTRO_STYLES.map((option) => <button key={option} type="button" role="radio" aria-checked={style === option} onClick={() => { setStyle(option); if (look.astro) setAstro(look.astro.icon, option); }}>{t(`astros.style.${option}`)}</button>)}
        </div>
        <div className="mobile-look-astros" role="radiogroup" aria-label={t("projectLook.astro")}>
          {ASTRO_ICONS.map((icon) => <button key={icon} type="button" role="radio" aria-checked={look.astro?.icon === icon} aria-label={t(`astros.icon.${icon}`)} onClick={() => setAstro(icon)}>
            <AstroIcon icon={icon} style={style} color={tint} size={28} still />
          </button>)}
        </div>
      </section>
      <section>
        <h2>{t("projectLook.emoji")}</h2>
        <div className="mobile-look-emojis">
          {EMOJIS.map((emoji) => <button key={emoji} type="button" aria-pressed={look.emoji === emoji} aria-label={emoji} onClick={() => void update({ type: "setEmoji", projectId, emoji })}>{emoji}</button>)}
        </div>
      </section>
      <section>
        <h2>{t("projectLook.color")}</h2>
        <div className="mobile-astro-colors" role="radiogroup" aria-label={t("projectLook.color")}>
          <button type="button" role="radio" aria-checked={!look.color} aria-label={t("projectLook.defaultColor")} style={{ background: PROJECT_COLORS.gray }} onClick={() => void update({ type: "setColor", projectId, color: null })} />
          {COLOR_ORDER.map((id) => <button key={id} type="button" role="radio" aria-checked={look.color === id} aria-label={t(`projectLook.colors.${id}`)} style={{ background: PROJECT_COLORS[id] }} onClick={() => void update({ type: "setColor", projectId, color: id })} />)}
        </div>
      </section>
      {look.astro || look.emoji ? <section>
        <button type="button" className="mobile-danger" onClick={() => { if (look.astro) setAstro(null); if (look.emoji) void update({ type: "setEmoji", projectId, emoji: null }); }}>{t("mobile.removeIcon")}</button>
        <p className="mobile-help">{t("mobile.logoOnMac")}</p>
      </section> : <p className="mobile-help">{t("mobile.logoOnMac")}</p>}
    </div>
  </div>;
}
