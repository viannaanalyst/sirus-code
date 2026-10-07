import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { onRemoteConnection, remoteReachable } from "@/client";
import { flushOutbox } from "@/lib/phone-outbox";
import { registerPushWorker } from "@/client/remote-push";
import { House, Folder, Planet, Settings } from "@/components/icons/phosphor";
import { ErrorToast } from "@/components/ErrorToast";
import { TopToastStack } from "@/components/TopToastStack";
import { ImageGalleryHost } from "@/components/ImageLightbox";
import { AttachmentModal } from "@/components/AttachmentModal";
import { useTranslation } from "@/i18n/use-translation";
import { dismissAppSplash } from "@/lib/app-splash";
import { cn } from "@/lib/cn";
import { isSheet, listedSessions, needsYou, type MobileScreen, type MobileTab } from "@/lib/mobile";
import { motionTokens } from "@/lib/motion";
import { applyAppearance } from "@/lib/settings";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { useSystemPalette } from "@/lib/use-system-palette";
import { TooltipProvider } from "@/primitives/Tooltip";
import { bindRealtime, selectSessionsMeta, useAppStore } from "@/store/app-store";
import { MobileArchived } from "./MobileArchived";
import { MobileAstros } from "./MobileAstros";
import { MobileBrowser } from "./MobileBrowser";
import { MobileChat } from "./MobileChat";
import { MobileFiles } from "./MobileFiles";
import { MobileGit } from "./MobileGit";
import { MobileHome } from "./MobileHome";
import { MobileNewAstro } from "./MobileNewAstro";
import { MobileNewSession } from "./MobileNewSession";
import { MobileProjectLook } from "./MobileProjectLook";
import { MobileProjects } from "./MobileProjects";
import { MobileReview } from "./MobileReview";
import { MobileSettings } from "./MobileSettings";
import { MobileTerminal } from "./MobileTerminal";
import "@/styles/mobile.css";

export interface MobileNavigation {
  open: (screen: MobileScreen) => void;
  /** Swaps the top page, e.g. the new-conversation sheet for the conversation it started. */
  replace: (screen: MobileScreen) => void;
  back: () => void;
}

/**
 * The phone app (ADR-081): four tabs and a stack of full-screen pages over the
 * same store and native commands as the Mac window. The browser history mirrors
 * the stack, so the system back gesture closes the top page.
 */
export default function MobileApp() {
  const t = useTranslation();
  const reducedMotion = useMotionPreferences();
  const systemPalette = useSystemPalette();
  const bootstrap = useAppStore((state) => state.bootstrap);
  const ready = useAppStore((state) => state.ready);
  const settings = useAppStore((state) => state.settings);
  const hostInfo = useAppStore((state) => state.hostInfo);
  const sessions = useAppStore(selectSessionsMeta);
  const [tab, setTab] = useState<MobileTab>("home");
  const [stack, setStack] = useState<MobileScreen[]>([]);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void bindRealtime().then((unbind) => {
      if (cancelled) { unbind(); return; }
      cleanup = unbind;
      void bootstrap();
    }).catch((error: unknown) => useAppStore.setState({ ready: true, error: String(error) }));
    return () => { cancelled = true; cleanup?.(); };
  }, [bootstrap]);
  useEffect(() => { if (ready) requestAnimationFrame(dismissAppSplash); }, [ready]);
  useEffect(() => { applyAppearance(settings, hostInfo?.appearanceSupport, systemPalette); }, [settings, hostInfo, systemPalette]);
  useEffect(() => onRemoteConnection((state) => setOnline(state === "open" || state === "connecting" || state === "idle")), []);
  // Messages written while the Mac was out of reach go out once it answers again (ADR-086).
  useEffect(() => {
    const flush = () => { if (useAppStore.getState().ready && remoteReachable()) void flushOutbox((message) => useAppStore.getState().sendPrompt(message.prompt, message.execution, message.sessionId)); };
    flush();
    const stopConnection = onRemoteConnection((state) => { if (state === "open") setTimeout(flush, 1500); });
    const stopReady = useAppStore.subscribe((state, previous) => { if (state.ready && !previous.ready) flush(); });
    return () => { stopConnection(); stopReady(); };
  }, []);

  useEffect(() => {
    window.history.replaceState({ depth: 0 }, "");
    const onPop = (event: PopStateEvent) => {
      const depth = typeof (event.state as { depth?: unknown } | null)?.depth === "number" ? (event.state as { depth: number }).depth : 0;
      setStack((current) => current.slice(0, depth));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const open = useCallback((screen: MobileScreen) => {
    setStack((current) => {
      window.history.pushState({ depth: current.length + 1 }, "");
      return [...current, screen];
    });
  }, []);
  const replace = useCallback((screen: MobileScreen) => setStack((current) => [...current.slice(0, -1), screen]), []);
  const back = useCallback(() => window.history.back(), []);
  // A tapped alert opens its conversation: on launch through `?session=`, later by message.
  useEffect(() => {
    void registerPushWorker();
    const linked = new URLSearchParams(window.location.search).get("session");
    if (linked) window.history.replaceState({ depth: 0 }, "", window.location.pathname);
    const openSession = (id: string) => {
      const target = useAppStore.getState().sessions.find((session) => session.id === id);
      if (!target) return;
      // A side chat's alert opens the conversation it belongs to.
      const sessionId = target.sideChat?.parentSessionId ?? target.id;
      setTab("home");
      setStack([]);
      window.history.replaceState({ depth: 0 }, "");
      open({ kind: "chat", sessionId });
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; sessionId?: unknown } | null;
      if (data?.type === "open-session" && typeof data.sessionId === "string") openSession(data.sessionId);
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    let stop: (() => void) | undefined;
    if (linked) {
      if (useAppStore.getState().ready) openSession(linked);
      else stop = useAppStore.subscribe((state) => { if (state.ready) { stop?.(); stop = undefined; openSession(linked); } });
    }
    return () => { navigator.serviceWorker?.removeEventListener("message", onMessage); stop?.(); };
  }, [open]);
  const navigation = useMemo<MobileNavigation>(() => ({ open, replace, back }), [open, replace, back]);

  const waiting = listedSessions(sessions, settings.archivedSessionIds).filter(needsYou).length;
  const top = stack.at(-1);
  const tabs: { id: MobileTab; label: string; icon: typeof House }[] = [
    { id: "home", label: t("mobile.home"), icon: House },
    { id: "projects", label: t("mobile.projects"), icon: Folder },
    { id: "astros", label: t("astros.title"), icon: Planet },
    { id: "settings", label: t("mobile.settings"), icon: Settings },
  ];

  return <MotionConfig reducedMotion={reducedMotion ? "always" : "never"} transition={{ duration: reducedMotion ? 0 : motionTokens.fast, ease: motionTokens.ease }}>
    <TooltipProvider>
      <div className="mobile-app">
        <main className="mobile-tab-page" aria-hidden={top ? true : undefined}>
          {tab === "home" ? <MobileHome navigation={navigation} online={online} /> : null}
          {tab === "projects" ? <MobileProjects navigation={navigation} /> : null}
          {tab === "astros" ? <MobileAstros navigation={navigation} /> : null}
          {tab === "settings" ? <MobileSettings online={online} /> : null}
        </main>
        <nav className="mobile-tabbar mobile-glass" aria-label={t("mobile.home")} style={{ "--tab-index": tabs.findIndex((item) => item.id === tab), "--tab-count": tabs.length } as React.CSSProperties}>
          {/* One glass pill glides to the chosen tab. */}
          <span className="mobile-tab-indicator" aria-hidden="true" />
          {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" className="mobile-tab" aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
            <span className="mobile-tab-icon"><Icon size={23} aria-hidden="true" />{id === "home" && waiting ? <span className="mobile-tab-badge">{waiting}</span> : null}</span>
            <span>{label}</span>
          </button>)}
        </nav>
        <AnimatePresence>
          {stack.map((screen, index) => <motion.section
            key={`${index}:${screen.kind}`}
            className={cn("mobile-screen", isSheet(screen) && "mobile-screen-sheet")}
            initial={isSheet(screen) ? { y: "100%" } : { x: "100%" }}
            animate={isSheet(screen) ? { y: 0 } : { x: 0 }}
            exit={isSheet(screen) ? { y: "100%" } : { x: "100%" }}
            transition={{ duration: reducedMotion ? 0 : motionTokens.normal, ease: motionTokens.ease }}
            aria-hidden={index < stack.length - 1 ? true : undefined}
          >
            {screen.kind === "chat" ? <MobileChat sessionId={screen.sessionId} navigation={navigation} /> : null}
            {screen.kind === "new" ? <MobileNewSession projectId={screen.projectId} navigation={navigation} /> : null}
            {screen.kind === "new-astro" ? <MobileNewAstro navigation={navigation} /> : null}
            {screen.kind === "archived" ? <MobileArchived navigation={navigation} /> : null}
            {screen.kind === "git" ? <MobileGit sessionId={screen.sessionId} navigation={navigation} /> : null}
            {screen.kind === "files" ? <MobileFiles sessionId={screen.sessionId} navigation={navigation} /> : null}
            {screen.kind === "browser" ? <MobileBrowser sessionId={screen.sessionId} navigation={navigation} /> : null}
            {screen.kind === "project-look" ? <MobileProjectLook projectId={screen.projectId} navigation={navigation} /> : null}
            {screen.kind === "edit-astro" ? <MobileNewAstro astroId={screen.astroId} navigation={navigation} /> : null}
            {screen.kind === "review" ? <MobileReview sessionId={screen.sessionId} navigation={navigation} /> : null}
            {screen.kind === "terminal" ? <MobileTerminal sessionId={screen.sessionId} navigation={navigation} /> : null}
          </motion.section>)}
        </AnimatePresence>
        <TopToastStack>
          <ErrorToast />
          <ImageGalleryHost />
          <AttachmentModal />
        </TopToastStack>
      </div>
    </TooltipProvider>
  </MotionConfig>;
}
