import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, MotionConfig, motion, useDragControls, type Transition } from "motion/react";
import type { ReactNode } from "react";
import { client, onRemoteConnection, remoteReachable } from "@/client";
import { flushOutbox } from "@/lib/phone-outbox";
import { knownProjectRemote, noteProjectRemote } from "@/lib/phone-continue";
import { registerPushWorker } from "@/client/remote-push";
import { ErrorToast } from "@/components/ErrorToast";
import { setPhoneFileOpener } from "@/components/ChatMarkdown";
import { SnoozeToast } from "@/components/SnoozeToast";
import { TopToastStack } from "@/components/TopToastStack";
import { ImageGalleryHost } from "@/components/ImageLightbox";
import { AttachmentModal } from "@/components/AttachmentModal";
import { cn } from "@/lib/cn";
import { isSheet, type MobileScreen } from "@/lib/mobile";
import { motionTokens } from "@/lib/motion";
import { usePhonePrefs, withPhonePrefs } from "@/lib/phone-prefs";
import { needsYouCount, syncAppBadge } from "@/lib/phone-live";
import { parsePhonePromptLink, resolveLinkedProject, withoutPromptLink } from "@/lib/phone-prompt-link";
import { translate } from "@/i18n";
import { applyAppearance } from "@/lib/settings";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { useSystemPalette } from "@/lib/use-system-palette";
import { TooltipProvider } from "@/primitives/Tooltip";
import { bindRealtime, selectSessionsMeta, useAppStore } from "@/store/app-store";
import { useEnvironments } from "@/store/environments-store";
import { MobileAddProject } from "./MobileAddProject";
import { MobileArchived } from "./MobileArchived";
import { MobileChooseProject } from "./MobileChooseProject";
import { MobileChat } from "./MobileChat";
import { MobileFiles } from "./MobileFiles";
import { MobileGit } from "./MobileGit";
import { MobileHome } from "./MobileHome";
import { MobileLaunch } from "./MobileLaunch";
import { MobileNewSession } from "./MobileNewSession";
import { MobileProjectLook } from "./MobileProjectLook";
import { MobileProjects } from "./MobileProjects";
import { MobileReview } from "./MobileReview";
import { MobileSettings } from "./MobileSettings";
import { MobileSnoozed } from "./MobileSnoozed";
import { MobileTerminal } from "./MobileTerminal";
import "@/styles/mobile.css";
import "@/styles/mobile-chat.css";
import "@/styles/mobile-home.css";

export interface MobileNavigation {
  open: (screen: MobileScreen) => void;
  /** Swaps the top page, e.g. the new-conversation sheet for the conversation it started. */
  replace: (screen: MobileScreen) => void;
  back: () => void;
}

/**
 * The phone app (ADR-081): the home inbox and a stack of pages and sheets over the
 * same store and native commands as the Mac window (no tab bar). The browser history mirrors
 * the stack, so the system back gesture closes the top page.
 */
export default function MobileApp() {
  const reducedMotion = useMotionPreferences();
  const systemPalette = useSystemPalette();
  const bootstrap = useAppStore((state) => state.bootstrap);
  const settings = useAppStore((state) => state.settings);
  const hostInfo = useAppStore((state) => state.hostInfo);
  const prefs = usePhonePrefs((state) => state.prefs);
  const [stack, setStack] = useState<MobileScreen[]>([]);
  const [online, setOnline] = useState(true);

  // The other computers on this phone (ADR-132), watched for the merged Home.
  useEffect(() => useEnvironments.getState().start(), []);
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
  useEffect(() => usePhonePrefs.getState().activate(), []);
  // This phone's own look (theme, text and code sizes) over the Mac's settings.
  useEffect(() => { applyAppearance(withPhonePrefs(settings, prefs), hostInfo?.appearanceSupport, systemPalette); }, [settings, prefs, hostInfo, systemPalette]);
  useEffect(() => onRemoteConnection((state) => setOnline(state === "open" || state === "connecting" || state === "idle")), []);
  // Each project's GitHub address, noted while its computer answers, so a conversation can
  // continue on another computer once this one is off (ADR-133 addendum).
  useEffect(() => {
    let running = false;
    const note = async () => {
      const app = useAppStore.getState();
      const environmentId = useEnvironments.getState().storeId;
      if (running || !app.ready || !remoteReachable() || useEnvironments.getState().switchingTo) return;
      running = true;
      try {
        for (const project of app.projects) {
          if (knownProjectRemote(environmentId, project.id) || useEnvironments.getState().storeId !== environmentId) continue;
          const url = await client.projectRemoteUrl(project.id).catch(() => null);
          if (useEnvironments.getState().storeId === environmentId) noteProjectRemote(environmentId, project.id, url);
        }
      } finally {
        running = false;
      }
    };
    void note();
    return useAppStore.subscribe((state, previous) => { if (state.ready && (!previous.ready || state.projects !== previous.projects)) void note(); });
  }, []);
  // Messages written while the Mac was out of reach go out once it answers again (ADR-086).
  useEffect(() => {
    // Each message goes to the computer its conversation is on (ADR-132).
    const here = (message: { sessionId: string }) => useAppStore.getState().sessions.some((session) => session.id === message.sessionId);
    const flush = () => { if (useAppStore.getState().ready && remoteReachable() && !useEnvironments.getState().switchingTo) void flushOutbox(async (message) => {
      // The conversation as the computer has it now: a send names the last reply it follows, and
      // the copy cached while offline may be behind, which the computer refuses as stale.
      await useAppStore.getState().ensureTranscript(message.sessionId, true);
      // The same id on every try: a send the computer took before its answer was lost is not run twice.
      return useAppStore.getState().sendPrompt(message.prompt, message.execution, message.sessionId, message.clientRequestId);
    }, localStorage, here); };
    flush();
    const stopConnection = onRemoteConnection((state) => { if (state === "open") setTimeout(flush, 1500); });
    const stopReady = useAppStore.subscribe((state, previous) => { if (state.ready && !previous.ready) flush(); });
    const stopSwitch = useEnvironments.subscribe((state, previous) => { if (previous.switchingTo && !state.switchingTo) flush(); });
    return () => { stopConnection(); stopReady(); stopSwitch(); };
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
  // A prompt link (`?prompt=…`, ADR-124) opens the new-conversation sheet with the prompt
  // filled in, once the projects are known. It never sends; the address loses the link at once.
  useEffect(() => {
    const link = parsePhonePromptLink(window.location.search);
    if (!link) return;
    window.history.replaceState({ depth: 0 }, "", `${window.location.pathname}${withoutPromptLink(window.location.search)}`);
    const show = () => {
      const state = useAppStore.getState();
      if (link.kind === "invalid") {
        const t = (key: string) => translate(state.settings.locale, key);
        useAppStore.setState({ error: `${t("promptLink.invalid")}. ${t(`promptLink.reason.${link.reason}`)}` });
        return;
      }
      const project = resolveLinkedProject(link.project, state.projects);
      open({ kind: "new", projectId: project?.id ?? null, link: { prompt: link.prompt, hiddenCharacters: link.hiddenCharacters, missingProject: link.project && !project ? link.project : null, provider: link.provider, model: link.model } });
    };
    if (useAppStore.getState().ready) { show(); return; }
    const stop = useAppStore.subscribe((state) => { if (state.ready) { stop(); show(); } });
    return stop;
  }, [open]);
  // A tapped alert opens its conversation: on launch through `?session=`, later by message.
  useEffect(() => {
    void registerPushWorker();
    const linked = new URLSearchParams(window.location.search).get("session");
    if (linked) window.history.replaceState({ depth: 0 }, "", `${window.location.pathname}${withoutSession(window.location.search)}`);
    const openSession = (id: string) => {
      const target = useAppStore.getState().sessions.find((session) => session.id === id);
      if (!target) {
        // An alert from a computer that is not the active one switches to it first (ADR-132).
        const environments = useEnvironments.getState();
        const owner = Object.entries(environments.summaries).find(([environment, summary]) => environment !== environments.storeId && summary.sessions.some((session) => session.id === id))?.[0];
        if (owner) void environments.activate(owner).then((switched) => { if (switched && useAppStore.getState().sessions.some((session) => session.id === id)) openSession(id); });
        return;
      }
      // A side chat's alert opens the conversation it belongs to.
      const sessionId = target.sideChat?.parentSessionId ?? target.id;
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
  // A file named in a reply opens on the Files screen (the desktop opens its editor pane).
  useEffect(() => setPhoneFileOpener((sessionId, path, directory) => open({ kind: "files", sessionId, open: path, dir: directory })), [open]);

  const top = stack.at(-1);

  return <MotionConfig reducedMotion={reducedMotion ? "always" : "never"} transition={{ duration: reducedMotion ? 0 : motionTokens.fast, ease: motionTokens.ease }}>
    <TooltipProvider>
      <div className="mobile-app">
        <MobileLaunch />
        <AppIconBadge />
        <motion.main className="mobile-tab-page" aria-hidden={top ? true : undefined}
          animate={top && !isSheet(top) ? COVERED : UNCOVERED} transition={reducedMotion ? { duration: 0 } : PUSH}>
          <MobileHome navigation={navigation} online={online} />
        </motion.main>
        {/* A sheet over the home dims what it covers; a tap there closes it. */}
        <AnimatePresence>
          {top && isSheet(top) && stack.length === 1 ? <motion.div key="scrim" className="mobile-sheet-scrim" aria-hidden="true" onClick={back}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : motionTokens.normal, ease: motionTokens.ease }} /> : null}
        </AnimatePresence>
        <AnimatePresence>
          {stack.map((screen, index) => <StackPage
            key={`${index}:${screen.kind}`}
            sheet={isSheet(screen)}
            covered={index < stack.length - 1 && !isSheet(stack[index + 1])}
            hidden={index < stack.length - 1}
            canSwipeBack={index === stack.length - 1}
            reduced={reducedMotion}
            onBack={back}
          >
            {screen.kind === "projects" ? <MobileProjects navigation={navigation} /> : null}
            {screen.kind === "settings" ? <MobileSettings online={online} navigation={navigation} /> : null}
            {screen.kind === "chat" ? <MobileChat sessionId={screen.sessionId} navigation={navigation} /> : null}
            {screen.kind === "new" ? <MobileNewSession projectId={screen.projectId} link={screen.link} navigation={navigation} /> : null}
            {screen.kind === "choose-project" ? <MobileChooseProject navigation={navigation} /> : null}
            {screen.kind === "add-project" ? <MobileAddProject then={screen.then} navigation={navigation} /> : null}
            {screen.kind === "archived" ? <MobileArchived navigation={navigation} /> : null}
            {screen.kind === "snoozed" ? <MobileSnoozed navigation={navigation} /> : null}
            {screen.kind === "git" ? <MobileGit sessionId={screen.sessionId} navigation={navigation} /> : null}
            {screen.kind === "files" ? <MobileFiles sessionId={screen.sessionId} open={screen.open} directory={screen.dir} navigation={navigation} /> : null}
            {screen.kind === "project-look" ? <MobileProjectLook projectId={screen.projectId} navigation={navigation} /> : null}
            {screen.kind === "review" ? <MobileReview sessionId={screen.sessionId} navigation={navigation} /> : null}
            {screen.kind === "terminal" ? <MobileTerminal sessionId={screen.sessionId} navigation={navigation} /> : null}
          </StackPage>)}
        </AnimatePresence>
        <TopToastStack phone>
          <ErrorToast />
          <SnoozeToast />
          <ImageGalleryHost />
          <AttachmentModal />
        </TopToastStack>
      </div>
    </TooltipProvider>
  </MotionConfig>;
}

/** The query string without `session`, keeping anything else the address carries. */
/** iOS's push: the new page slides in on a spring, the one below drifts left and dims. */
const PUSH: Transition = { type: "spring", stiffness: 420, damping: 42, mass: 1 };
const COVERED = { x: "-28%", filter: "brightness(0.72)" };
const UNCOVERED = { x: 0, filter: "brightness(1)" };

/**
 * One page of the stack, after the iPhone's navigation: pages push
 * in from the right, sheets rise from the bottom, a covered page drifts left and dims, and the
 * top page follows a drag from the left edge back to the previous one.
 */
function StackPage({ sheet, covered, hidden, canSwipeBack, reduced, onBack, children }: { sheet: boolean; covered: boolean; hidden: boolean; canSwipeBack: boolean; reduced: boolean; onBack: () => void; children: ReactNode }) {
  const drag = useDragControls();
  const transition = reduced ? { duration: 0 } : sheet ? { duration: motionTokens.normal, ease: motionTokens.ease } : PUSH;
  const swipe = !sheet && canSwipeBack && !reduced;
  return <motion.section
    className={cn("mobile-screen", sheet && "mobile-screen-sheet")}
    initial={sheet ? { y: "100%" } : { x: "100%" }}
    animate={sheet ? { y: 0 } : covered ? COVERED : UNCOVERED}
    exit={sheet ? { y: "100%" } : { x: "100%", filter: "brightness(1)" }}
    transition={transition}
    aria-hidden={hidden || undefined}
    drag={swipe ? "x" : false}
    dragControls={drag}
    dragListener={false}
    dragConstraints={{ left: 0, right: 0 }}
    dragElastic={{ left: 0, right: 1 }}
    dragMomentum={false}
    onDragEnd={(_, info) => { if (info.offset.x > window.innerWidth * 0.35 || info.velocity.x > 600) onBack(); }}
  >
    {children}
    {/* The left edge starts a swipe back, as everywhere on iOS. */}
    {swipe ? <div className="mobile-swipe-edge" aria-hidden="true" onPointerDown={(event) => drag.start(event)} /> : null}
  </motion.section>;
}

function withoutSession(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("session");
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

/**
 * The home-screen icon shows how many conversations need the person (ADR-124); the service
 * worker sets it from alerts while the app is closed. Its own component, so session updates
 * do not re-render the page stack.
 */
function AppIconBadge() {
  const ready = useAppStore((state) => state.ready);
  const archived = useAppStore((state) => state.settings.archivedSessionIds);
  const waiting = useAppStore((state) => needsYouCount(selectSessionsMeta(state), archived));
  useEffect(() => { if (ready) void syncAppBadge(waiting); }, [ready, waiting]);
  return null;
}
