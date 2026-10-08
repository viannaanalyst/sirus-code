import { SIDEBAR_RAIL_WIDTH } from "@/lib/sidebar-panels";
import { ImageGalleryHost } from "@/components/ImageLightbox";
import { AttachmentModal } from "@/components/AttachmentModal";
import { useSidebarMotion } from "@/lib/sidebar-motion";
import { dismissAppSplash } from "@/lib/app-splash";
import { effectiveShortcut, KEYBINDINGS, shortcutLabel } from "@/lib/keybindings";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { useTranslation } from "@/i18n/use-translation";
import { client } from "@/client";
import { useChatBackground } from "@/lib/use-chat-background";
import { QuitToast } from "@/components/QuitToast";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Archive, Columns3, Folder, Inbox, ListTodo, GitPullRequest, FolderPlus, MessagesSquare, PanelLeft, PanelRight, PanelRightOpen, Search, Settings, SquarePen, SquareTerminal, TextSearch } from "@/components/icons/phosphor";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ErrorToast } from "@/components/ErrorToast";
import { TopToastStack } from "@/components/TopToastStack";
import { WindowSnapToast } from "@/components/WindowSnapToast";
import { WorktreeReleaseToast } from "@/components/WorktreeReleaseToast";
import { ActivityNotifications } from "@/components/ActivityNotifications";
import { ProviderUpdateToast } from "@/components/ProviderUpdateToast";
import { CommandPalette } from "@/components/CommandPalette";
import { EnvironmentPanel, EnvironmentToggle } from "@/components/EnvironmentPanel";
import { RightDock } from "@/components/RightDock";
import { SplitWorkspace } from "@/components/SplitWorkspace";
import { AgentIcon } from "@/components/AgentIcon";
import { WindowNavigationControls } from "@/components/WindowNavigationControls";
import { HeaderTabs } from "@/components/HeaderTabs";
import { visibleTabSessions } from "@/lib/header-tabs";
import { Sidebar } from "@/components/Sidebar";
import { applyAppearance } from "@/lib/settings";
import { isConversationStarted } from "@/lib/appearance";
import { useSystemPalette } from "@/lib/use-system-palette";
import { motionTokens } from "@/lib/motion";
import type { CommandItem } from "@/lib/shortcuts";
import { createShortcutController, escapeStopsAgent, workspaceShortcutsAvailable } from "@/lib/shortcuts";
import { ResizeHandle } from "@/primitives/ResizablePanel";
import { TooltipProvider } from "@/primitives/Tooltip";
import { IconButton } from "@/primitives/IconButton";
import { cn } from "@/lib/cn";
import { setAmbientCovered } from "@/lib/ambient-motion";
import {
  bindRealtime,
  selectCurrentSession,
  selectListedSessions,
  useAppStore,
} from "@/store/app-store";

const SettingsPage = lazy(() => import("@/components/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const CreateProjectDialog = lazy(() => import("@/components/CreateProjectDialog").then((module) => ({ default: module.CreateProjectDialog })));
const NewSessionDialog = lazy(() => import("@/components/NewSessionDialog").then((module) => ({ default: module.NewSessionDialog })));
const SessionBoard = lazy(() => import("@/components/SessionBoard").then((module) => ({ default: module.SessionBoard })));
const InboxPage = lazy(() => import("@/components/InboxPage").then((module) => ({ default: module.InboxPage })));
const ArchivedPage = lazy(() => import("@/components/ArchivedPage").then((module) => ({ default: module.ArchivedPage })));
const TasksPage = lazy(() => import("@/components/tasks/TasksPage").then((module) => ({ default: module.TasksPage })));
const PullRequestsPage = lazy(() => import("@/components/pull-requests/PullRequestsPage").then((module) => ({ default: module.PullRequestsPage })));

/** Header tabs are on screen only with the sidebar collapsed, outside Settings, overlays and Kanban. */
function headerTabsVisible() {
  const state = useAppStore.getState();
  return state.sidebarCollapsed && !state.settingsOpen && !state.paletteOpen && !state.newSessionOpen && state.mainView === "session" && !!state.selectedProjectId;
}

function selectHeaderTab(pick: (tabs: string[], current: number) => string | undefined) {
  const state = useAppStore.getState();
  const projectId = state.selectedProjectId;
  if (!projectId) return;
  const tabs = visibleTabSessions(state.openTabsByProject[projectId] ?? [], selectListedSessions(state), projectId, state.settings.archivedSessionIds).map((session) => session.id);
  if (!tabs.length) return;
  const target = pick(tabs, Math.max(0, tabs.indexOf(state.selectedSessionId ?? "")));
  if (target && target !== state.selectedSessionId) void state.selectSession(target);
}

export default function App() {
  const systemPalette = useSystemPalette();
  const t = useTranslation();
  const reducedMotion = useMotionPreferences();
  const bootstrap = useAppStore((state) => state.bootstrap);
  const settingsOpen = useAppStore((state) => state.settingsOpen);
  const mainView = useAppStore((state) => state.mainView);
  const setMainView = useAppStore((state) => state.setMainView);
  const newSessionOpen = useAppStore((state) => state.newSessionOpen);
  // Stays mounted after the first open so closing plays the dialog's exit.
  const [newSessionMounted, setNewSessionMounted] = useState(false);
  if (newSessionOpen && !newSessionMounted) setNewSessionMounted(true);
  const createProjectOpen = useAppStore((state) => state.createProjectOpen);
  const [createProjectMounted, setCreateProjectMounted] = useState(createProjectOpen);
  if (createProjectOpen && !createProjectMounted) setCreateProjectMounted(true);
  const sidebarWidth = useAppStore((state) => state.sidebarWidth);
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const [sidebarMotion, endSidebarMotion] = useSidebarMotion(sidebarCollapsed);
  const dockWidth = useAppStore((state) => state.dockWidth);
  const dockOpen = useAppStore((state) => state.dockOpen);
  const dockMaximized = useAppStore((state) => state.dockMaximized);
  const resizeSidebar = useAppStore((state) => state.resizeSidebar);
  const setDockWidth = useAppStore((state) => state.setDockWidth);
  const toggleDock = useAppStore((state) => state.toggleDock);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const environmentOpen = useAppStore((state) => state.environmentOpen);
  const hostInfo = useAppStore((state) => state.hostInfo);
  const settings = useAppStore((state) => state.settings);
  const requestNewSession = useAppStore((state) => state.requestNewSession);
  const setPaletteOpen = useAppStore((state) => state.setPaletteOpen);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const setNewSessionOpen = useAppStore((state) => state.setNewSessionOpen);
  const addProjectFromPicker = useAppStore((state) => state.addProjectFromPicker);
  const sendPrompt = useAppStore((state) => state.sendPrompt);
  const stopAgent = useAppStore((state) => state.stopAgent);
  const setSessionModel = useAppStore((state) => state.setSessionModel);
  const projects = useAppStore((state) => state.projects);
  const agents = useAppStore((state) => state.agents);
  // Narrow fields only: streamed output must not re-render the whole window.
  const sessionAgent = useAppStore((state) => selectCurrentSession(state)?.agent);
  const sessionTitle = useAppStore((state) => selectCurrentSession(state)?.title);
  const conversationStarted = useAppStore((state) => isConversationStarted(selectCurrentSession(state)));

  const commands: CommandItem[] = useMemo(
    () => {
      const shortcut = (id: Parameters<typeof effectiveShortcut>[1]) => shortcutLabel(effectiveShortcut(settings.customShortcuts, id));
      const actions = t("palette.quickActions");
      return [
        { id: "new-session", label: t("New thread"), group: actions, icon: <SquarePen />, shortcut: shortcut("new-session"), run: () => requestNewSession() },
        { id: "open-project", label: t("Open Project"), group: actions, icon: <FolderPlus />, shortcut: shortcut("open-project"), run: () => void addProjectFromPicker() },
        { id: "create-project", label: t("newProject.menu"), group: actions, icon: <FolderPlus />, run: () => useAppStore.getState().setCreateProjectOpen(true) },
        { id: "toggle-side-chat", label: t("Toggle side chat"), group: actions, icon: <MessagesSquare />, shortcut: shortcut("toggle-side-chat"), run: () => { setMainView("session"); useAppStore.getState().toggleSideChat(); } },
        { id: "search-conversations", label: t("Search all conversations"), group: actions, icon: <Search />, shortcut: shortcut("search-conversations"), run: () => { setMainView("session"); useAppStore.getState().openTranscriptSearch("all"); } },
        { id: "find-in-conversation", label: t("Find in conversation"), group: actions, icon: <TextSearch />, shortcut: shortcut("find-in-conversation"), run: () => { setMainView("session"); useAppStore.getState().openTranscriptSearch(); } },
        { id: "kanban", label: t("Kanban"), group: actions, icon: <Columns3 />, run: () => setMainView("kanban") },
        { id: "pull-requests", label: t("pulls.title"), group: actions, icon: <GitPullRequest />, run: () => setMainView("pulls") },
        { id: "inbox", label: t("inbox.title"), group: actions, icon: <Inbox />, run: () => setMainView("inbox") },
        { id: "tasks", label: t("tasks.title"), group: actions, icon: <ListTodo />, run: () => setMainView("tasks") },
        { id: "open-terminal", label: t("Open Terminal"), group: actions, icon: <SquareTerminal />, shortcut: shortcut("open-terminal"), run: () => useAppStore.getState().openDockPane("terminal") },
        { id: "toggle-context", label: t("Toggle right panel"), group: actions, icon: <PanelRight />, shortcut: shortcut("toggle-context"), run: () => toggleDock() },
        { id: "toggle-sidebar", label: t("Toggle Sidebar"), group: actions, icon: <PanelLeft />, shortcut: shortcut("toggle-sidebar"), run: toggleSidebar },
        ...projects.map((project) => ({ id: `project-${project.id}`, label: project.name, group: t("Projects"), icon: <Folder />, run: () => void useAppStore.getState().selectProject(project.id) })),
        { id: "settings", label: t("Open Settings"), group: t("Settings"), icon: <Settings />, shortcut: shortcut("settings"), run: () => setSettingsOpen(true) },
      ];
    },
    [addProjectFromPicker, requestNewSession, setSettingsOpen, setMainView, toggleDock, toggleSidebar, t, projects, settings.customShortcuts],
  );

  const ready = useAppStore((state) => state.ready);
  // Settings stays mounted after its first open so it can play its exit; the closed dialog renders nothing.
  const [settingsMounted, setSettingsMounted] = useState(false);
  if (settingsOpen && !settingsMounted) setSettingsMounted(true);
  // Wait for the first ready paint so the splash can find the landing glyph.
  useEffect(() => { if (ready) requestAnimationFrame(dismissAppSplash); }, [ready]);
  // Settings covers the whole window, so decorative loops underneath stop.
  useEffect(() => setAmbientCovered(settingsOpen), [settingsOpen]);

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

  useEffect(() => {
    applyAppearance(settings, hostInfo?.appearanceSupport, systemPalette);
  }, [settings, hostInfo, systemPalette]);

  useChatBackground(settings.chatBackground, settings.chatBackgroundEffect);

  // "Open in Sirus Code" from the floating Astro chat (ADR-088).
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void client.onAstroOpenInMain((sessionId) => {
      const store = useAppStore.getState();
      const astro = store.astros?.find((item) => item.sessionId === sessionId);
      if (astro) void store.openAstro(astro.id);
      else void store.selectSession(sessionId);
    }).then((unlisten) => { if (cancelled) unlisten(); else stop = unlisten; });
    return () => { cancelled = true; stop?.(); };
  }, []);

  useEffect(() => {
    const onKey = createShortcutController(() => [
      { id: "palette", combo: "Meta+k", run: () => setPaletteOpen(true) },
      { id: "new-session", combo: "Meta+n", run: () => requestNewSession() },
      // ⌘T opens a new blank tab of the selected project, like a browser (fixed, not customizable).
      { id: "new-tab", combo: "Meta+t", when: () => { const state = useAppStore.getState(); return !state.settingsOpen && !state.paletteOpen; }, run: () => requestNewSession() },
      { id: "settings", combo: "Meta+,", run: () => setSettingsOpen(true) },
      { id: "toggle-context", combo: "Meta+\\", run: toggleDock },
      { id: "open-terminal", combo: "Meta+`", run: () => { useAppStore.getState().openDockPane("terminal"); } },
      { id: "open-files", combo: "Meta+alt+o", when: () => workspaceShortcutsAvailable(useAppStore.getState()), run: () => useAppStore.getState().openDockPane("files") },
      { id: "open-browser", combo: "Meta+alt+b", when: () => workspaceShortcutsAvailable(useAppStore.getState()), run: () => useAppStore.getState().openDockPane("browser") },
      { id: "toggle-environment", combo: "Meta+alt+e", when: () => workspaceShortcutsAvailable(useAppStore.getState()), run: () => useAppStore.getState().toggleEnvironment() },
      { id: "toggle-side-chat", combo: "Meta+alt+s", when: () => workspaceShortcutsAvailable(useAppStore.getState()), run: () => useAppStore.getState().toggleSideChat() },
      ...(["find-in-conversation", "search-conversations"] as const).map(id => ({ id, combo: id === "find-in-conversation" ? "Meta+f" : "Meta+shift+f", when: () => { const state = useAppStore.getState(); return !state.settingsOpen && !state.paletteOpen && !state.newSessionOpen && state.mainView === "session"; }, run: () => {
        // Pressing the shortcut again closes the open search of that scope.
        const store = useAppStore.getState(), scope = id === "find-in-conversation" ? "session" : "all";
        if (store.transcriptSearch?.scope === scope) store.closeTranscriptSearch();
        else store.openTranscriptSearch(scope);
      } })),
      { id: "stop-agent", combo: "Meta+.", run: () => void stopAgent() },
      { id: "toggle-sidebar", combo: "Meta+b", run: () => toggleSidebar() },
      { id: "open-project", combo: "Meta+o", run: () => void addProjectFromPicker() },
      {
        id: "back",
        combo: "Meta+[",
        run: () => useAppStore.getState().goBack(),
      },
      {
        id: "forward",
        combo: "Meta+]",
        run: () => useAppStore.getState().goForward(),
      },
      {
        id: "escape",
        combo: "Escape",
        run: (event: KeyboardEvent) => {
          const state = useAppStore.getState();
          if (state.settingsOpen) {
            state.setSettingsOpen(false);
            return;
          }
          if (escapeStopsAgent(state, event.target)) {
            void stopAgent();
            return;
          }
          setPaletteOpen(false);
        },
      },
      // Fixed header-tab shortcuts; active only while the tab strip is visible.
      ...Array.from({ length: 9 }, (_, index) => ({
        id: `tab-${index + 1}`,
        combo: `Meta+${index + 1}`,
        when: headerTabsVisible,
        run: () => selectHeaderTab((tabs) => tabs[index]),
      })),
      { id: "next-tab", combo: "Meta+Alt+ArrowRight", when: headerTabsVisible, run: () => selectHeaderTab((tabs, current) => tabs[(current + 1) % tabs.length]) },
      { id: "previous-tab", combo: "Meta+Alt+ArrowLeft", when: headerTabsVisible, run: () => selectHeaderTab((tabs, current) => tabs[(current - 1 + tabs.length) % tabs.length]) },
      { id: "switch-project", combo: "Meta+Shift+P", when: headerTabsVisible, run: () => useAppStore.getState().setProjectSwitcherOpen(true) },
    ].map((binding) => {

      const entry = KEYBINDINGS.find((item) => item.id === binding.id);
      return entry ? { ...binding, combo: effectiveShortcut(useAppStore.getState().settings.customShortcuts, entry.id) } : binding;
    }));
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addProjectFromPicker, requestNewSession, setPaletteOpen, setSettingsOpen, toggleSidebar, toggleDock, stopAgent]);


  return (
    <MotionConfig reducedMotion={reducedMotion ? "always" : "never"} transition={{ duration: reducedMotion ? 0 : motionTokens.fast, ease: motionTokens.ease }}>
    <TooltipProvider>
      <div data-settings-open={settingsOpen} className="app-material relative flex h-dvh min-h-0 text-text-primary">
        <WindowNavigationControls />
        <div aria-hidden="true" className="app-content-frame" />
        <div className="sidebar-frame relative z-10 shrink-0" data-motion={sidebarMotion ?? undefined} style={{ width: sidebarCollapsed ? SIDEBAR_RAIL_WIDTH : sidebarWidth }}
          onTransitionEnd={event => { if (event.target === event.currentTarget && event.propertyName === "width") endSidebarMotion(); }}>
          <Sidebar motion={sidebarMotion} />
          {!sidebarCollapsed && <div className="absolute inset-y-0 right-0 z-20 flex"><ResizeHandle value={sidebarWidth} onResize={resizeSidebar} /></div>}
        </div>

        <AnimatePresence initial={false}>
        {dockOpen && dockMaximized ? null : (
        <motion.div
          key="main"
          initial={false}
          exit={{ opacity: 0, transition: { duration: reducedMotion ? 0 : motionTokens.instant } }}
          className={cn("flex min-w-0 min-h-0 flex-1 flex-col", mainView === "session" && conversationStarted ? "sidebar-material" : "main-material")}
        >
          <header
            data-tauri-drag-region
            className={`titlebar-drag flex h-[var(--window-controls-height)] shrink-0 items-center gap-1 pr-2 ${sidebarCollapsed ? "pl-[calc(var(--window-controls-inset)+80px-52px)]" : "pl-2"}`}
          >
            {/* With the sidebar collapsed the header carries the project switcher and its session tabs. */}
            {sidebarCollapsed && mainView === "session" ? <HeaderTabs /> : <div className="mt-[calc((var(--window-controls-height)-26px)/2)] inline-flex h-[26px] min-w-0 max-w-[min(640px,65vw)] self-start items-center gap-2 px-2 ui-control text-text-primary">
              {mainView === "kanban" ? <Columns3 size={13} className="shrink-0 text-text-muted" /> : mainView === "pulls" ? <GitPullRequest size={13} className="shrink-0 text-text-muted" /> : mainView === "inbox" ? <Inbox size={13} className="shrink-0 text-text-muted" /> : mainView === "tasks" ? <ListTodo size={13} className="shrink-0 text-text-muted" /> : mainView === "archived" ? <Archive size={13} className="shrink-0 text-text-muted" /> : <AgentIcon id={sessionAgent ?? settings.defaultAgent} className="rounded-none bg-transparent" />}
              <span className="truncate">{mainView === "kanban" ? t("Kanban") : mainView === "pulls" ? t("pulls.title") : mainView === "inbox" ? t("inbox.title") : mainView === "tasks" ? t("tasks.title") : mainView === "archived" ? t("Archived sessions") : sessionTitle ?? t("session.new")}</span>
            </div>}
            <div className="titlebar-no-drag mt-[calc((var(--window-controls-height)-26px)/2)] ml-auto flex h-[26px] self-start items-center gap-0.5">
              <EnvironmentToggle />
              <IconButton
                label={t(dockOpen ? "Collapse panel" : "Open right panel")}
                shortcut={shortcutLabel(effectiveShortcut(settings.customShortcuts, "toggle-context"))}
                aria-expanded={dockOpen}
                onClick={toggleDock}
                className="size-6 min-h-0 rounded-[6px] p-0 text-text-muted"
              >
                {dockOpen ? <PanelRightOpen size={14} strokeWidth={1.7} /> : <PanelRight size={14} strokeWidth={1.7} />}
              </IconButton>
            </div>
          </header>

          <div className={cn(
            "relative flex min-h-0 flex-1 transition-[padding] duration-[var(--motion-normal)] ease-[var(--ease-out)] motion-reduce:transition-none",
            environmentOpen && !dockOpen && "pr-[312px]",
          )}>
            {mainView === "session" ? <SplitWorkspace
              agents={agents}
              onSend={sendPrompt}
              onStop={() => void stopAgent()}
              onNewSession={() => setNewSessionOpen(true)}
              onModelChange={(provider, model) => void setSessionModel(provider, model)}
            /> : null}
            {mainView === "kanban" ? <Suspense fallback={<div className="flex-1" aria-busy="true" />}><SessionBoard /></Suspense> : null}
            {mainView === "inbox" ? <Suspense fallback={<div className="flex-1" aria-busy="true" />}><InboxPage /></Suspense> : null}
            {mainView === "tasks" ? <Suspense fallback={<div className="flex-1" aria-busy="true" />}><TasksPage /></Suspense> : null}
            {mainView === "archived" ? <Suspense fallback={<div className="flex-1" aria-busy="true" />}><ArchivedPage /></Suspense> : null}
            {mainView === "pulls" ? <Suspense fallback={<div className="flex-1" aria-busy="true" />}><PullRequestsPage /></Suspense> : null}
            <EnvironmentPanel />
          </div>

        </motion.div>
        )}
        </AnimatePresence>

        {dockOpen && !dockMaximized ? <ResizeHandle value={dockWidth} onResize={(delta) => setDockWidth(dockWidth - delta)} /> : null}
        {dockOpen && dockMaximized ? (
          <div className="min-w-0 flex-1">
            <RightDock />
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {dockOpen ? (
              <motion.div
                key="dock"
                initial={reducedMotion ? false : { width: 0, opacity: 0 }}
                animate={{ width: dockWidth, opacity: 1, transition: {
                  width: { duration: reducedMotion ? 0 : motionTokens.fast, ease: motionTokens.ease },
                  opacity: { delay: reducedMotion ? 0 : motionTokens.instant, duration: reducedMotion ? 0 : motionTokens.instant },
                } }}
                exit={{ width: 0, opacity: 0, transition: {
                  opacity: { duration: reducedMotion ? 0 : motionTokens.instant },
                  width: { delay: reducedMotion ? 0 : motionTokens.instant, duration: reducedMotion ? 0 : motionTokens.fast, ease: motionTokens.ease },
                } }}
                className="relative z-10 shrink-0 overflow-hidden"
              >
                <div style={{ width: dockWidth }} className="h-full">
                  <RightDock />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        )}

        <CommandPalette commands={commands} />
        <Suspense fallback={null}>
          {newSessionMounted ? <NewSessionDialog /> : null}
          {createProjectMounted ? <CreateProjectDialog /> : null}
          {settingsMounted ? <SettingsPage /> : null}
        </Suspense>
        <QuitToast />
        {!settingsOpen ? <TopToastStack>
          <ErrorToast />
          <WindowSnapToast />
          <WorktreeReleaseToast />
          <ActivityNotifications />
          <ProviderUpdateToast />
          <ImageGalleryHost />
          <AttachmentModal />
        </TopToastStack> : null}
      </div>
    </TooltipProvider>
    </MotionConfig>
  );
}
