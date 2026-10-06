import { useEffect } from "react";
import { AstroDrawer } from "@/components/astros/AstroDrawer";
import { AstroIcon } from "@/components/astros/AstroArt";
import { Plus } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { astroActivity } from "@/lib/astro-activity";
import { selectSessionsMeta, useAppStore } from "@/store/app-store";
import "@/styles/astros.css";

/** Astros on the rail (ADR-069): one button each, then New Astro, which opens its drawer. */
export function SidebarAstros({ onOpen }: { onOpen: () => void }) {
  const t = useTranslation();
  const astros = useAppStore((state) => state.astros);
  const selectedSessionId = useAppStore((state) => state.selectedSessionId);
  const mainView = useAppStore((state) => state.mainView);
  const sessions = useAppStore(selectSessionsMeta);
  useEffect(() => { if (astros === null) void useAppStore.getState().loadAstros(); }, [astros]);
  return <>
    <span className="sidebar-rail-divider" aria-hidden="true" />
    {astros?.map((astro) => {
      const current = mainView === "session" && Boolean(astro.sessionId) && astro.sessionId === selectedSessionId;
      return <button key={astro.id} type="button" className="sidebar-rail-button sidebar-rail-astro" aria-label={astro.name} title={astro.name} aria-current={current ? "page" : undefined} style={{ "--astro": astro.color } as React.CSSProperties}
        onPointerEnter={onOpen} onFocus={onOpen} onClick={() => { onOpen(); void useAppStore.getState().openAstro(astro.id); }}>
        <AstroIcon icon={astro.icon} style={astro.style} color={astro.color} size={26} activity={astroActivity(astro, sessions)} />
        {astro.unread > 0 && !current ? <span className="sidebar-rail-dot" aria-hidden="true" /> : null}
      </button>;
    })}
    <button type="button" className="sidebar-rail-button sidebar-rail-astro-add" aria-label={t("astros.new")} title={t("astros.new")}
      onPointerEnter={onOpen} onFocus={onOpen} onClick={() => { onOpen(); void useAppStore.getState().createAstro(t("astros.newName")); }}>
      <Plus size={16} />
    </button>
    <AstroDrawer />
  </>;
}
