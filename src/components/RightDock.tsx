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
  SquareTerminal,
  X,
} from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { selectCurrentProject, useAppStore, type DockPane, type DockPaneKind, selectCurrentSessionMeta } from "@/store/app-store";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/primitives/Dropdown";
import { IconButton } from "@/primitives/IconButton";
import { BrowserPanel } from "@/components/BrowserPanel";
import { FileTree } from "@/components/FileTree";
import { ChangesPane } from "@/components/ChangesPane";
import { SideChatPane } from "@/components/SideChatPane";
import { editorKey } from "@/lib/editor-state";
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
};

const launcher: DockPaneKind[] = ["terminal", "files", "changes", "browser", "sidechat"];

export function RightDock() {
  const t = useTranslation();
  const session = useAppStore(selectCurrentSessionMeta);
  // Same surface as the chat column beside it (App.tsx), so the dock never reads as a separate block.
  const conversationStarted = isConversationStarted(session);
  const project = useAppStore(selectCurrentProject);
  const panes = useAppStore((state) => state.dockPanes);
  const activePaneId = useAppStore((state) => state.dockActivePaneId);
  const maximized = useAppStore((state) => state.dockMaximized);
  const openDockPane = useAppStore((state) => state.openDockPane);
  const closeDockPane = useAppStore((state) => state.closeDockPane);
  const setActiveDockPane = useAppStore((state) => state.setActiveDockPane);
  const toggleDock = useAppStore((state) => state.toggleDock);
  const toggleDockMaximized = useAppStore((state) => state.toggleDockMaximized);
  const discardEditorBuffer = useAppStore((state) => state.discardEditorBuffer);
  // Only the set of unsaved files, so typing re-renders the dock only when a file turns dirty or clean.
  const dirtyKeys = useAppStore((state) => Object.keys(state.editorBuffers).filter((key) => { const buffer = state.editorBuffers[key]; return buffer.content.length !== buffer.saved.length || buffer.content !== buffer.saved; }).join("\u0000"));
  const dirtySet = useMemo(() => new Set(dirtyKeys ? dirtyKeys.split("\u0000") : []), [dirtyKeys]);
  const editorSaving = useAppStore((state) => state.editorSaving);
  const [pendingClose, setPendingClose] = useState<DockPane | null>(null);

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

  return (
    <aside className={cn("flex h-full min-w-0 flex-col border-l border-border-subtle", conversationStarted ? "sidebar-material" : "main-material")} aria-label={t("Right panel")}>
      <div data-tauri-drag-region className="flex h-[var(--window-controls-height)] shrink-0 items-center gap-1 px-1.5">
        <div className="scroll-thin flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {visible.map((pane) => (
            <DockTab
              key={pane.id}
              pane={pane}
              active={pane.id === active?.id}
              dirty={isDirty(pane)}
              onSelect={() => setActiveDockPane(pane.id)}
              onClose={() => requestClose(pane)}
            />
          ))}
        </div>
        <Dropdown>
          <DropdownTrigger asChild>
            <button type="button" aria-label={t("New panel")} title={t("New panel")} className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-text-muted hover:bg-background-3 hover:text-text-primary">
              <Plus size={13} />
            </button>
          </DropdownTrigger>
          <DropdownContent align="end" side="bottom">
            {launcher.map((kind) => (
              <DropdownItem key={kind} onSelect={() => openDockPane(kind)}>
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
    </aside>
  );
}

function DockTab({ pane, active, dirty, onSelect, onClose }: { pane: DockPane; active: boolean; dirty: boolean; onSelect: () => void; onClose: () => void }) {
  const t = useTranslation();
  const meta = paneMeta[pane.kind];
  const label = pane.document?.name ?? (pane.kind === "editor" && pane.path ? pane.path.split("/").at(-1) ?? meta.label : meta.label);
  return (
    <div className={cn("group relative flex h-6 shrink-0 items-center rounded-[6px] transition-colors duration-[var(--motion-fast)]", active ? "bg-background-3 text-text-primary" : "text-text-muted hover:bg-background-3/70 hover:text-text-secondary")}>
      <button type="button" className="flex min-w-0 items-center gap-1.5 py-1 pl-1.5 pr-2" aria-pressed={active} onClick={onSelect}>
        <meta.icon size={12} aria-hidden="true" className="transition-opacity duration-[var(--motion-fast)] group-hover:opacity-0" />
        <span className="max-w-[140px] truncate ui-caption">{dirty ? `• ${t(label)}` : t(label)}</span>
      </button>
      <button type="button" aria-label={t("Close panel")} title={t("Close panel")}
        className="absolute left-[3px] top-1/2 flex size-4 -translate-y-1/2 items-center justify-center rounded-[4px] text-text-muted opacity-0 hover:text-text-primary group-hover:opacity-100 focus-visible:opacity-100"
        onClick={onClose}>
        <X size={11} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Explorer + inline editor side by side (no extra dock tab). */
function FilesPane({ sessionId, rootLabel }: { sessionId: string; rootLabel: string }) {
  const t = useTranslation();
  const setSelectedFile = useAppStore((state) => state.setSelectedFile);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  return <div className="flex h-full min-h-0">
    <div className="min-h-0 w-[220px] shrink-0 overflow-hidden border-r border-border-subtle">
      <FileTree key={sessionId} sessionId={sessionId} rootLabel={rootLabel} onOpenFile={(path) => {
        setSelectedPath(path);
        setSelectedFile(sessionId, path);
      }} />
    </div>
    <div className="min-w-0 flex-1">
      {selectedPath
        ? <Suspense fallback={<p className="px-3 py-6 ui-control text-text-muted">{t("common.loading")}</p>}>
            <EditorPane key={editorKey(sessionId, selectedPath)} sessionId={sessionId} path={selectedPath} onClose={() => setSelectedPath(null)} />
          </Suspense>
        : <p className="flex h-full items-center justify-center px-4 text-center ui-control text-text-muted">{t("Select a file to edit")}</p>}
    </div>
  </div>;
}

function DockLauncher({ onOpen }: { onOpen: (kind: DockPaneKind) => void }) {
  const t = useTranslation();
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
