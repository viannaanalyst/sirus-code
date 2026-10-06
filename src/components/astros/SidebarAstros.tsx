import { useEffect } from "react";
import { AstroDialog } from "@/components/astros/AstroDialog";
import { AstroIcon } from "@/components/astros/AstroArt";
import { Plus } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { selectSessionsMeta, useAppStore } from "@/store/app-store";
import { astroActivity } from "@/lib/astro-activity";
import "@/styles/astros.css";

/** Astros on the rail (ADR-069): one button each, then New Astro. Owns the Astro dialog. */
export function SidebarAstros({ onOpen }: { onOpen: () => void }) {
  const t = useTranslation();
  const astros = useAppStore((state) => state.astros);
  const dialog = useAppStore((state) => state.astroDialog);
  const selectedSessionId = useAppStore((state) => state.selectedSessionId);
  const mainView = useAppStore((state) => state.mainView);
  const sessions = useAppStore(selectSessionsMeta);
  useEffect(() => { if (astros === null) void useAppStore.getState().loadAstros(); }, [astros]);
  const editing = dialog?.editingId ? astros?.find((astro) => astro.id === dialog.editingId) ?? null : null;
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
      onPointerEnter={onOpen} onFocus={onOpen} onClick={() => { onOpen(); useAppStore.getState().setAstroDialog({ editingId: null }); }}>
      <Plus size={16} />
    </button>
    <AstroDialog open={dialog !== null} editing={editing} onClose={() => useAppStore.getState().setAstroDialog(null)} />
  </>;
}
