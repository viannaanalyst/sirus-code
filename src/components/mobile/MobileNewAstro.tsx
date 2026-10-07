import { useState } from "react";
import type { AstroIconId, AstroStyle } from "@/client/types";
import { AstroIcon } from "@/components/astros/AstroArt";
import { ArrowUp, X } from "@/components/icons/phosphor";
import { ProjectGlyph } from "@/components/ProjectGlyph";
import { useTranslation } from "@/i18n/use-translation";
import { ASTRO_COLORS, ASTRO_STYLES } from "@/lib/astro-art";
import { useAppStore } from "@/store/app-store";
import type { MobileNavigation } from "./MobileApp";
import { MobileSelect } from "./MobileSelect";

const ICONS: AstroIconId[] = ["planeta", "saturno", "lua", "sol", "estrela", "foguete", "cometa", "galaxia"];

/**
 * A new Astro from the phone, or an existing one to edit (`astroId`): name, icon in Metal
 * or Neon, colour and project. Its soul and memory are shaped on the Mac.
 */
export function MobileNewAstro({ navigation, astroId }: { navigation: MobileNavigation; astroId?: string }) {
  const t = useTranslation();
  const projects = useAppStore((state) => state.projects);
  const count = useAppStore((state) => state.astros?.length ?? 0);
  const existing = useAppStore((state) => astroId ? state.astros?.find((astro) => astro.id === astroId) ?? null : null);
  const [name, setName] = useState(existing?.name ?? "");
  const [icon, setIcon] = useState<AstroIconId>(existing?.icon ?? ICONS[count % ICONS.length]);
  const [style, setStyle] = useState<AstroStyle>(existing?.style ?? "metal");
  const [color, setColor] = useState<string>(existing?.color ?? ASTRO_COLORS[count % ASTRO_COLORS.length]);
  const [project, setProject] = useState(existing?.projectIds[0] ?? projects[0]?.id ?? null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!project || !name.trim() || busy) return;
    setBusy(true);
    const store = useAppStore.getState();
    // Editing keeps the soul, background and any further projects chosen on the Mac.
    const projectIds = existing ? [project, ...existing.projectIds.filter((id) => id !== project)] : [project];
    const astro = await store.saveAstro({ id: existing?.id ?? null, name: name.trim(), icon, style, color, background: existing?.background ?? "liso", projectIds, soul: existing?.soul ?? "" });
    if (!astro) { setBusy(false); return; }
    if (existing) { navigation.back(); return; }
    await store.openAstro(astro.id);
    const sessionId = useAppStore.getState().astros?.find((item) => item.id === astro.id)?.sessionId;
    if (sessionId) navigation.replace({ kind: "chat", sessionId });
    else navigation.back();
  };

  return <div className="mobile-page mobile-sheet">
    <span className="mobile-sheet-grip" aria-hidden="true" />
    <header className="mobile-sheet-head">
      <button type="button" className="mobile-sheet-close mobile-glass" aria-label={t("mobile.cancel")} onClick={navigation.back}><X size={17} aria-hidden="true" /></button>
      <h1>{t(existing ? "mobile.editAstro" : "astros.new")}</h1>
      <span />
    </header>
    <div className="mobile-scroll mobile-form">
      <div className="mobile-astro-preview" style={{ "--astro": color } as React.CSSProperties}>
        <AstroIcon icon={icon} style={style} color={color} size={64} />
      </div>
      <section>
        <input className="mobile-input" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("mobile.astroName")} aria-label={t("mobile.astroName")} maxLength={40} enterKeyHint="done" />
      </section>
      <section>
        <h2>{t("astros.style")}</h2>
        <div className="mobile-segmented" role="radiogroup" aria-label={t("astros.style")}>
          {ASTRO_STYLES.map((option) => <button key={option} type="button" role="radio" aria-checked={style === option} onClick={() => setStyle(option)}>{t(`astros.style.${option}`)}</button>)}
        </div>
      </section>
      <section>
        <h2>{t("mobile.astroIcon")}</h2>
        <div className="mobile-astro-icons" role="radiogroup" aria-label={t("mobile.astroIcon")}>
          {ICONS.map((item) => <button key={item} type="button" role="radio" aria-checked={icon === item} aria-label={t(`astros.icon.${item}`)} onClick={() => setIcon(item)}>
            <AstroIcon icon={item} style={style} color={color} size={30} still />
          </button>)}
        </div>
      </section>
      <section>
        <h2>{t("mobile.astroColor")}</h2>
        <div className="mobile-astro-colors" role="radiogroup" aria-label={t("mobile.astroColor")}>
          {ASTRO_COLORS.map((item) => <button key={item} type="button" role="radio" aria-checked={color === item} aria-label={item} style={{ background: item }} onClick={() => setColor(item)} />)}
        </div>
      </section>
      <section className="mobile-fields">
        <MobileSelect label={t("mobile.project")} value={project} onChange={setProject}
          options={projects.map((item) => ({ value: item.id, label: item.name, icon: <ProjectGlyph project={item} size={16} /> }))} />
        <p className="mobile-help">{t("mobile.astroHelp")}</p>
      </section>
      <button type="button" className="mobile-primary" disabled={!project || !name.trim() || busy} onClick={() => void create()}>{t(existing ? "common.save" : "mobile.astroCreate")}{existing ? null : <ArrowUp size={15} aria-hidden="true" />}</button>
    </div>
  </div>;
}
