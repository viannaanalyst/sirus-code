import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Globe, PanelRight, X } from "@/components/icons/phosphor";
import { agentPageShows, cornerPosition, clampPlayerPosition, miniPlayerSize, nearestCorner, type PlayerPoint } from "@/lib/mini-player";
import { motionTokens } from "@/lib/motion";
import { useBrowserBounds } from "@/lib/use-browser-bounds";
import { useTranslation } from "@/i18n/use-translation";
import { isDockBrowserShowing, useAppStore } from "@/store/app-store";

/** The composer and its padding sit under the conversation; the player rests above them. */
const COMPOSER_INSET = 136;

/**
 * A page an agent opened, floating over the conversation's bottom-right corner (ADR-151). The native
 * browser view is positioned into the player's frame like the dock's pane. Hidden while the dock's
 * browser shows the session, and parked (its bounds cleared) whenever the frame is not visible.
 */
export function AgentPagePlayer() {
  const t = useTranslation();
  const sessionId = useAppStore((state) => state.selectedSessionId);
  const url = useAppStore((state) => (sessionId ? state.agentPageBySession[sessionId] : undefined));
  const browser = useAppStore((state) => (sessionId ? state.browserBySession[sessionId] : undefined));
  const corner = useAppStore((state) => state.playerCorner);
  const dockShowing = useAppStore((state) => Boolean(sessionId) && isDockBrowserShowing(state, sessionId ?? ""));
  const setPlayerCorner = useAppStore((state) => state.setPlayerCorner);
  const hideAgentPage = useAppStore((state) => state.hideAgentPage);
  const openDockPane = useAppStore((state) => state.openDockPane);
  const active = browser?.tabs.find((tab) => tab.id === browser.activeTabId) ?? null;
  const blank = !active || !active.url || active.url === "about:blank";
  const visible = Boolean(sessionId) && agentPageShows({ revealed: Boolean(url), browserOpen: Boolean(browser?.open), pageLoaded: Boolean(active) && !blank, pictureInPicture: Boolean(browser?.pictureInPicture), dockShowing });

  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState({ width: 0, height: 0 });
  const [drag, setDrag] = useState<PlayerPoint | null>(null);
  const grab = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const measure = () => setSpace({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const player = miniPlayerSize(space, COMPOSER_INSET);
  const rest = cornerPosition(corner, space, player, COMPOSER_INSET);
  const at = drag ?? rest;
  // The native view follows the frame's position, which a resize observer does not see: a window
  // resize re-measures it (use-browser-bounds), so a moving player sends its new rect the same way.
  useEffect(() => { window.dispatchEvent(new Event("resize")); }, [at.x, at.y, player.width, player.height]);
  useBrowserBounds(sessionId ?? "", frame, visible);

  const onGrab = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    grab.current = { pointerX: event.clientX, pointerY: event.clientY, x: at.x, y: at.y };
  };
  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = grab.current;
    if (!start) return;
    setDrag(clampPlayerPosition({ x: start.x + event.clientX - start.pointerX, y: start.y + event.clientY - start.pointerY }, space, player, COMPOSER_INSET));
  };
  const onDrop = () => {
    if (!grab.current) return;
    grab.current = null;
    if (drag) setPlayerCorner(nearestCorner(drag, space, player, COMPOSER_INSET));
    setDrag(null);
  };
  const close = () => { if (sessionId) hideAgentPage(sessionId); };
  const openInPanel = () => {
    if (!sessionId) return;
    hideAgentPage(sessionId);
    openDockPane("browser");
  };

  const control = "grid size-6 shrink-0 place-items-center rounded-[6px] text-text-muted transition-colors duration-[var(--motion-fast)] hover:bg-background-3 hover:text-text-primary";
  return <div ref={container} className="pointer-events-none absolute inset-0 z-20">
    <AnimatePresence initial={false}>
      {visible && sessionId ? <motion.section key="agent-page" aria-label={t("browser.agentPage")}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: motionTokens.fast, ease: motionTokens.ease }}
        style={{ left: at.x, top: at.y, width: player.width, height: player.height }}
        className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-[12px] border border-border-subtle bg-background-2 shadow-[0_12px_32px_rgba(0,0,0,0.35)]">
        <div onPointerDown={onGrab} onPointerMove={onMove} onPointerUp={onDrop} onPointerCancel={onDrop} title={t("browser.movePlayer")}
          className="flex h-8 shrink-0 cursor-grab touch-none select-none items-center gap-1.5 px-2 active:cursor-grabbing">
          <Globe size={12} aria-hidden="true" className="shrink-0 text-text-muted" />
          <span className="min-w-0 flex-1 truncate ui-caption text-text-secondary">{active?.title || active?.url}</span>
          <button type="button" title={t("browser.openInPanel")} aria-label={t("browser.openInPanel")} onClick={openInPanel} className={control}><PanelRight size={12} aria-hidden="true" /></button>
          <button type="button" title={t("browser.closePlayer")} aria-label={t("browser.closePlayer")} onClick={close} className={control}><X size={12} aria-hidden="true" /></button>
        </div>
        <div ref={frame} className="min-h-0 flex-1 bg-background-1" />
      </motion.section> : null}
    </AnimatePresence>
  </div>;
}
