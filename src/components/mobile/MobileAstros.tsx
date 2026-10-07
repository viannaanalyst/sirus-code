import { useEffect, useState } from "react";
import { AstroIcon } from "@/components/astros/AstroArt";
import { ChevronRight, LoaderCircle } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { astroActivity } from "@/lib/astro-activity";
import { selectSessionsMeta, useAppStore } from "@/store/app-store";
import type { MobileNavigation } from "./MobileApp";
import "@/styles/astros.css";

const ACTIVITY_KEYS = { "needs-you": "mobile.needsYou", working: "mobile.working", idle: "mobile.astroIdle" } as const;

/** The person's Astros (ADR-069): tap one to talk to it. Creating and editing stay on the Mac. */
export function MobileAstros({ navigation }: { navigation: MobileNavigation }) {
  const t = useTranslation();
  const astros = useAppStore((state) => state.astros);
  const sessions = useAppStore(selectSessionsMeta);
  const projects = useAppStore((state) => state.projects);
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => { void useAppStore.getState().loadAstros(); }, []);

  const open = async (id: string) => {
    if (opening) return;
    setOpening(id);
    await useAppStore.getState().openAstro(id);
    setOpening(null);
    const sessionId = useAppStore.getState().astros?.find((astro) => astro.id === id)?.sessionId;
    if (sessionId) navigation.open({ kind: "chat", sessionId });
  };

  return <div className="mobile-page">
    <header className="mobile-header mobile-header-large">
      <div>
        <h1>{t("astros.title")}</h1>
        <p>{t("mobile.astroIntro")}</p>
      </div>
    </header>
    <div className="mobile-scroll">
      {astros?.length ? <div className="mobile-list">
        {astros.map((astro) => {
          const activity = astroActivity(astro, sessions);
          const scope = astro.projectIds.map((id) => projects.find((project) => project.id === id)?.name).filter(Boolean).join(", ");
          // An Astro works inside its projects; without one it cannot start (as on the Mac).
          const ready = astro.projectIds.length > 0;
          return <button key={astro.id} type="button" className="mobile-astro" disabled={!ready} onClick={() => void open(astro.id)} aria-busy={opening === astro.id || undefined}>
            <span className="mobile-astro-icon" style={{ "--astro": astro.color } as React.CSSProperties}>
              <AstroIcon icon={astro.icon} style={astro.style} color={astro.color} size={34} activity={activity} />
              {astro.unread > 0 ? <span className="mobile-astro-unread">{astro.unread}</span> : null}
            </span>
            <span className="mobile-project-text">
              <span className="mobile-project-name">{astro.name}</span>
              <span className="mobile-project-status" data-attention={activity === "needs-you" ? "" : undefined}>
                {ready ? <>{t(ACTIVITY_KEYS[activity])}{scope ? ` · ${scope}` : ""}</> : t("mobile.astroNoProject")}
              </span>
            </span>
            {opening === astro.id ? <LoaderCircle size={15} className="animate-spin text-text-muted" aria-hidden="true" /> : <ChevronRight size={15} className="text-text-muted" aria-hidden="true" />}
          </button>;
        })}
      </div> : astros ? <p className="mobile-empty">{t("mobile.noAstros")}</p> : null}
    </div>
  </div>;
}
