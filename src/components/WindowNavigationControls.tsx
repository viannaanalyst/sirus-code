import { ArrowLeft, ArrowRight, PanelLeft } from "lucide-react";
import { useTranslation } from "@/i18n/use-translation";
import { IconButton } from "@/primitives/IconButton";
import { useAppStore } from "@/store/app-store";

/** Shared native-window chrome, including settings and a collapsed sidebar. */
export function WindowNavigationControls() {
  const t = useTranslation();
  const collapsed = useAppStore(state => state.sidebarCollapsed);
  const toggleSidebar = useAppStore(state => state.toggleSidebar);
  const index = useAppStore(state => state.navIndex);
  const length = useAppStore(state => state.navHistory.length);
  const goBack = useAppStore(state => state.goBack);
  const goForward = useAppStore(state => state.goForward);
  const controlClass = "size-[24px] min-h-0 rounded-[6px] p-0 text-text-muted";
  return <div className="titlebar-no-drag absolute top-0 left-[var(--window-controls-inset)] z-30 flex h-[var(--window-controls-height)] items-center gap-0.5">
    <IconButton tooltip={false} label={t(collapsed ? "sidebar.show" : "sidebar.hide")} aria-expanded={!collapsed} onClick={toggleSidebar} className={controlClass}><PanelLeft size={14} strokeWidth={1.7} /></IconButton>
    <IconButton tooltip={false} label={t("Back")} disabled={index <= 0} onClick={goBack} className={controlClass}><ArrowLeft size={14} strokeWidth={1.7} /></IconButton>
    <IconButton tooltip={false} label={t("Forward")} disabled={index >= length - 1} onClick={goForward} className={controlClass}><ArrowRight size={14} strokeWidth={1.7} /></IconButton>
  </div>;
}
