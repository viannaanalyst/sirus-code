import { lazy, Suspense, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Files,
  FileCode2,
  FileText,
  GitCompareArrows,
  Globe,
  Maximize2,
  MessagesSquare,
  Minimize2,
  PanelRightClose,
  Plus,
  Smartphone,
  SquareTerminal,
  X,
  XCircle,
} from "@/components/icons/phosphor";
import { ContextMenu } from "@/components/arc/context-menu/context-menu";
import { dockCloseAllPrompt, planDockCloseAll, type DockCloseAllPlan } from "@/lib/dock-close-all";
import { useTranslation } from "@/i18n/use-translation";
import { useHostFeatures } from "@/components/mobile/use-phone-host";
import { selectCurrentProject, useAppStore, type DockPane, type DockPaneKind, selectCurrentSessionMeta } from "@/store/app-store";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/primitives/Dropdown";
import { IconButton } from "@/primitives/IconButton";
import { BrowserPanel } from "@/components/BrowserPanel";
import { FileTree } from "@/components/FileTree";
import { ChangesPane } from "@/components/ChangesPane";
import { SideChatPane } from "@/components/SideChatPane";
import { editorKey } from "@/lib/editor-state";
import type { EditorReveal } from "@/components/editor/CodeEditor";
import { usePointerReorder } from "@/lib/use-pointer-reorder";
import { isConversationStarted } from "@/lib/appearance";
import { cn } from "@/lib/cn";
import { motionTokens } from "@/lib/motion";

const TerminalTabsPane = lazy(async () => {
  const module = await import("@/components/TerminalPanel");
  return { default: module.TerminalTabsPane };
});

const EditorPane = lazy(async () => {
  const module = await import("@/components/EditorPane");
  return { default: module.EditorPane };
});
const DocumentReader = lazy(async () => {
  const module = await import("@/components/DocumentReader");
  return { default: module.DocumentReader };
});

const DevicesPane = lazy(async () => ({ default: (await import("@/components/devices/DevicesPane")).DevicesPane }));

const TurnReviewPane = lazy(async () => {
  const module = await import("@/components/TurnReviewPane");
  return { default: module.TurnReviewPane };
});

const paneMeta: Record<DockPaneKind, { label: string; icon: typeof Files }> = {
  terminal: { label: "Terminal", icon: SquareTerminal },
  files: { label: "Files", icon: Files },
  changes: { label: "Changes", icon: GitCompareArrows },
  editor: { label: "Editor", icon: FileCode2 },
  browser: { label: "Browser", icon: Globe },
  review: { label: "review.title", icon: GitCompareArrows },
  document: { label: "reader.title", icon: FileText },
  sidechat: { label: "sideChat.title", icon: MessagesSquare },
  devices: { label: "devices.title", icon: Smartphone },
};

const allLaunchers: DockPaneKind[] = ["terminal", "files", "changes", "browser", "sidechat", "devices"];

/** The panels the active computer offers: a server has no browser or devices (ADR-131, ADR-133). */
function useLauncher(): DockPaneKind[] {
  const features = useHostFeatures();
  return allLaunchers.filter((kind) => (kind !== "browser" || features.browser) && (kind !== "devices" || features.devices));
}

export function RightDock() {
  const t = useTranslation();
  const launcher = useLauncher();
  const session = useAppStore(selectCurrentSessionMeta);
  // Same surface as the chat column beside it (App.tsx), so the dock never reads as a separate block.
  const conversationStarted = isConversationStarted(session);
  const project = useAppStore(selectCurrentProject);
  const panes = useAppStore((state) => state.dockPanes);
  const activePaneId = useAppStore((state) => state.dockActivePaneId);
  const maximized = useAppStore((state) => state.dockMaximized);
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const openDockPane = useAppStore((state) => state.openDockPane);
  const closeDockPane = useAppStore((state) => state.closeDockPane);
  const setActiveDockPane = useAppStore((state) => state.setActiveDockPane);
  const reorder = usePointerReorder({ axis: "x", onDrop: (source, target, edge) => useAppStore.getState().moveDockPane(source, target, edge) });
  const toggleDock = useAppStore((state) => state.toggleDock);
  const toggleDockMaximized = useAppStore((state) => state.toggleDockMaximized);
  const discardEditorBuffer = useAppStore((state) => state.discardEditorBuffer);
  // Only the set of unsaved files, so typing re-renders the dock only when a file turns dirty or clean.
  const dirtyKeys = useAppStore((state) => Object.keys(state.editorBuffers).filter((key) => { const buffer = state.editorBuffers[key]; return buffer.content.length !== buffer.saved.length || buffer.content !== buffer.saved; }).join("\u0000"));
  const dirtySet = useMemo(() => new Set(dirtyKeys ? dirtyKeys.split("\u0000") : []), [dirtyKeys]);
  const editorSaving = useAppStore((state) => state.editorSaving);
  const [pendingClose, setPendingClose] = useState<DockPane | null>(null);
  const [pendingCloseAll, setPendingCloseAll] = useState<DockCloseAllPlan | null>(null);
  // The tab under the pointer when the tab strip's context menu opened; null for the empty strip.
  const [menuPaneId, setMenuPaneId] = useState<string | null>(null);

  const isDirty = (pane: DockPane) => {
    if (pane.kind !== "editor" || !pane.path || !pane.sessionId) return false;
    return dirtySet.has(editorKey(pane.sessionId, pane.path));
  };

  const visible = useMemo(
    () => panes.filter((pane) => pane.kind === "document" ? pane.document?.scope === (session ? `session:${session.id}` : `project:${project?.id}`) : (pane.kind !== "editor" && pane.kind !== "review" && pane.kind !== "sidechat") || (session !== null && pane.sessionId === session.id)),
    [panes, session, project],
  );
  const active = visible.find((pane) => pane.id === activePaneId) ?? visible[0] ?? null;

  const requestClose = (pane: DockPane) => {
    if (pane.kind === "editor" && pane.sessionId && pane.path && editorSaving[editorKey(pane.sessionId, pane.path)]) return;
    if (isDirty(pane)) {
      setPendingClose(pane);
      return;
    }
    if (pane.kind === "editor" && pane.path && pane.sessionId) {
      discardEditorBuffer(editorKey(pane.sessionId, pane.path));
    }
    closeDockPane(pane.id);
  };

  // Close all tabs: every pane the strip shows, behind one confirmation for all unsaved files.
  const closePanes = (ids: readonly string[]) => {
    for (const id of ids) {
      const state = useAppStore.getState();
      const pane = state.dockPanes.find((item) => item.id === id);
      if (!pane) continue;
      if (pane.kind === "editor" && pane.path && pane.sessionId) {
        const key = editorKey(pane.sessionId, pane.path);
        if (state.editorSaving[key]) continue;
        discardEditorBuffer(key);
      }
      closeDockPane(id);
    }
  };
  const requestCloseAll = () => {
    const plan = planDockCloseAll(visible.map((pane) => ({
      id: pane.id,
      dirty: isDirty(pane),
      saving: !!(pane.kind === "editor" && pane.sessionId && pane.path && editorSaving[editorKey(pane.sessionId, pane.path)]),
    })));
    if (dockCloseAllPrompt(plan)) setPendingCloseAll(plan);
    else closePanes(plan.close);
  };
  const closeAllPrompt = pendingCloseAll ? dockCloseAllPrompt(pendingCloseAll) : null;
  const menuPane = menuPaneId ? visible.find((pane) => pane.id === menuPaneId) ?? null : null;

  return (
    <aside className={cn("flex h-full min-w-0 flex-col border-l border-border-subtle", conversationStarted ? "sidebar-material" : "main-material")} aria-label={t("Right panel")}>
      {/* Maximized, the panel takes the main header's place: its tabs start after the window
          buttons and the sidebar and history controls, like the header does. */}
      <div data-tauri-drag-region className={cn("flex h-[var(--window-controls-height)] shrink-0 items-center gap-1 px-1.5",
        maximized && (sidebarCollapsed ? "pl-[calc(var(--window-controls-inset)+80px)]" : "pl-[calc(var(--window-controls-inset)+80px-52px)]"))}>
        <div className="flex h-full min-w-0 flex-1 [&>div]:h-full [&>div]:w-full [&>div]:min-w-0">
        <ContextMenu activation="context-only" label={t("dock.tabActions")} items={[
          ...(menuPane ? [{ id: "close", label: t("Close panel"), icon: <X size={15} />, onSelect: () => requestClose(menuPane) }] : []),
          { id: "close-all", label: t("dock.closeAll"), icon: <XCircle size={15} />, disabled: visible.length === 0, onSelect: requestCloseAll },
        ]}>
        <div className="dock-tabs flex h-full min-w-0 flex-1 items-center gap-1" data-reorder-scope=""
          onContextMenuCapture={(event) => setMenuPaneId((event.target as HTMLElement).closest<HTMLElement>("[data-dock-pane]")?.dataset.dockPane ?? null)}>
          {visible.map((pane) => (
            <DockTab
              key={pane.id}
              pane={pane}
              active={pane.id === active?.id}
              dirty={isDirty(pane)}
              reorder={reorder.bind(pane.id)}
              dragging={reorder.dragging === pane.id}
              onSelect={() => setActiveDockPane(pane.id)}
              onClose={() => requestClose(pane)}
            />
          ))}
        </div>
        </ContextMenu>
        </div>
        <Dropdown>
          <DropdownTrigger asChild>
            <button type="button" aria-label={t("New panel")} title={t("New panel")} className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-text-muted hover:bg-background-3 hover:text-text-primary">
              <Plus size={13} />
            </button>
          </DropdownTrigger>
          <DropdownContent align="end" side="bottom">
            {launcher.map((kind) => (
              <DropdownItem key={kind} icon={(() => { const Icon = paneMeta[kind].icon; return <Icon size={15} />; })()} onSelect={() => openDockPane(kind)}>
                {t(paneMeta[kind].label)}
              </DropdownItem>
            ))}
          </DropdownContent>
        </Dropdown>
        <IconButton label={t(maximized ? "Restore panel" : "Maximize panel")} onClick={toggleDockMaximized} className="size-6 min-h-0 shrink-0 rounded-[6px] p-0 text-text-muted">
          {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </IconButton>
        <IconButton label={t("Collapse panel")} onClick={toggleDock} className="size-6 min-h-0 shrink-0 rounded-[6px] p-0 text-text-muted">
          <PanelRightClose size={13} />
        </IconButton>
      </div>
      <div className="relative min-h-0 flex-1">
        {visible.filter((pane) => pane.document).map((pane) => (
          <div key={pane.id} className={cn("h-full", active?.id === pane.id ? undefined : "hidden")}>
            <Suspense fallback={<p role="status" className="p-4 text-text-muted">{t("reader.loading")}</p>}>
              <DocumentReader document={pane.document!} active={active?.id === pane.id} />
            </Suspense>
          </div>
        ))}
        {/* Editor panes stay mounted while hidden so unsaved edits survive session and dock switches. */}
        {panes
          .filter((pane) => pane.kind === "editor" && pane.path && pane.sessionId)
          .map((pane) => (
            <div key={pane.id} className={cn("h-full", active?.id === pane.id ? undefined : "hidden")}>
              <Suspense fallback={<p className="px-3 py-6 ui-control text-text-muted">{t("common.loading")}</p>}>
                <EditorPane sessionId={pane.sessionId!} path={pane.path!} />
              </Suspense>
            </div>
          ))}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={!active ? "launcher" : active.id}
            className={cn("h-full", active?.kind === "document" && "hidden")}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: motionTokens.instant, ease: motionTokens.ease }}
          >
            {!session || !active ? (
              <DockLauncher onOpen={openDockPane} />
            ) : active.kind === "terminal" ? (
              <Suspense fallback={<p className="px-3 py-6 ui-control text-text-muted">{t("Abrindo terminal…")}</p>}>
                <TerminalTabsPane key={session.id} sessionId={session.id} />
              </Suspense>
            ) : active.kind === "files" ? (
              <FilesPane key={session.id} sessionId={session.id} rootLabel={project?.name ?? "root"} />
            ) : active.kind === "changes" ? (
              <ChangesPane key={`${session.id}:${session.worktree.path}`} sessionId={session.id} workspacePath={session.worktree.path} />
            ) : active.kind === "review" && active.review && active.sessionId ? (
              <Suspense fallback={<p role="status" className="p-4 text-text-muted">{t("common.loading")}</p>}>
                <TurnReviewPane key={`${active.id}:${active.review.path ?? ""}`} sessionId={active.sessionId} messageId={active.review.messageId} path={active.review.path} />
              </Suspense>
            ) : active.kind === "browser" ? (
              <BrowserPanel key={session.id} sessionId={session.id} />
            ) : active.kind === "devices" ? (
              <Suspense fallback={<p className="px-3 py-6 ui-control text-text-muted">{t("common.loading")}</p>}>
                <DevicesPane paneId={active.id} />
              </Suspense>
            ) : active.kind === "sidechat" && active.sessionId ? (
              <SideChatPane key={active.sessionId} parentSessionId={active.sessionId} paneId={active.id} />
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>
      <ConfirmDialog
        open={pendingClose !== null}
        onOpenChange={(open) => { if (!open) setPendingClose(null); }}
        title={t("Discard changes?")}
        description={t("This file has unsaved changes. Closing the tab will discard them.")}
        cancelLabel={t("Keep editing")}
        confirmLabel={t("Discard changes")}
        disabled={!!(pendingClose?.sessionId && pendingClose.path && editorSaving[editorKey(pendingClose.sessionId, pendingClose.path)])}
        onConfirm={() => {
          if (pendingClose?.sessionId && pendingClose.path) {
            if (useAppStore.getState().editorSaving[editorKey(pendingClose.sessionId, pendingClose.path)]) return false;
            discardEditorBuffer(editorKey(pendingClose.sessionId, pendingClose.path));
          }
          if (pendingClose) closeDockPane(pendingClose.id);
          setPendingClose(null);
        }}
      />
      <ConfirmDialog
        open={pendingCloseAll !== null}
        onOpenChange={(open) => { if (!open) setPendingCloseAll(null); }}
        title={t("Discard changes?")}
        description={closeAllPrompt ? t(closeAllPrompt.key, closeAllPrompt.params) : ""}
        cancelLabel={t("Keep editing")}
        confirmLabel={t("dock.closeAllConfirm")}
        onConfirm={() => {
          if (pendingCloseAll) closePanes(pendingCloseAll.close);
          setPendingCloseAll(null);
        }}
      />
    </aside>
  );
}

/** A pill tab: icon (a drag grip on hover), name and close; tabs shrink to fit and reorder by dragging. */
function DockTab({ pane, active, dirty, reorder, dragging, onSelect, onClose }: { pane: DockPane; active: boolean; dirty: boolean; reorder: ReturnType<ReturnType<typeof usePointerReorder>["bind"]>; dragging: boolean; onSelect: () => void; onClose: () => void }) {
  const t = useTranslation();
  const meta = paneMeta[pane.kind];
  const label = pane.document?.name ?? (pane.kind === "editor" && pane.path ? pane.path.split("/").at(-1) ?? meta.label : meta.label);
  return (
    <div {...reorder} data-dock-pane={pane.id} data-active={active || undefined} data-dragging={dragging || undefined} className="dock-tab group">
      <button type="button" className="dock-tab-open" aria-pressed={active} onClick={onSelect} title={t(label)}>
        <span className="dock-tab-icon" aria-hidden="true"><meta.icon size={14} /><span className="dock-tab-grip">⠿</span></span>
        <span className="dock-tab-label ui-control">{dirty ? `• ${t(label)}` : t(label)}</span>
      </button>
      <button type="button" data-no-reorder="" aria-label={t("Close panel")} title={t("Close panel")} className="dock-tab-close" onClick={onClose}>
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Explorer + inline editor side by side (no extra dock tab). */
function FilesPane({ sessionId, rootLabel }: { sessionId: string; rootLabel: string }) {
  const t = useTranslation();
  const setSelectedFile = useAppStore((state) => state.setSelectedFile);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // A search result opens the file at its line; a new object reveals again in the same file.
  const [reveal, setReveal] = useState<EditorReveal | undefined>(undefined);
  return <div className="flex h-full min-h-0">
    <div className="min-h-0 w-[220px] shrink-0 overflow-hidden border-r border-border-subtle">
      <FileTree key={sessionId} sessionId={sessionId} rootLabel={rootLabel} onOpenFile={(path, line, column) => {
        setSelectedPath(path);
        setReveal(line ? { line, column } : undefined);
        setSelectedFile(sessionId, path);
      }} />
    </div>
    <div className="min-w-0 flex-1">
      {selectedPath
        ? <Suspense fallback={<p className="px-3 py-6 ui-control text-text-muted">{t("common.loading")}</p>}>
            <EditorPane key={editorKey(sessionId, selectedPath)} sessionId={sessionId} path={selectedPath} reveal={reveal} onClose={() => setSelectedPath(null)} />
          </Suspense>
        : <p className="flex h-full items-center justify-center px-4 text-center ui-control text-text-muted">{t("Select a file to edit")}</p>}
    </div>
  </div>;
}

function DockLauncher({ onOpen }: { onOpen: (kind: DockPaneKind) => void }) {
  const t = useTranslation();
  const launcher = useLauncher();
  return (
    <nav aria-label={t("Open a panel")} className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="flex w-full max-w-sm flex-col gap-1.5">
        {launcher.map((kind) => {
          const meta = paneMeta[kind];
          return (
            <button key={kind} type="button" aria-label={t("Open {panel}", { panel: t(meta.label) })} onClick={() => onOpen(kind)} className="flex h-11 w-full items-center gap-3 rounded-xl border border-border-subtle bg-background-2 px-4 text-left ui-control text-text-secondary transition-colors duration-[var(--motion-fast)] hover:border-border-default hover:bg-background-3 hover:text-text-primary">
              <meta.icon size={15} className="shrink-0" aria-hidden="true" />
              <span>{t(meta.label)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
