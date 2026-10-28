import { composerContextForOwner, MAX_SNIPPET } from "@/lib/composer-context";
import { isConversationStarted, resolveAppearanceMaterial, terminalAppearance, terminalTransparent } from "@/lib/appearance";
import { terminalSurface } from "@/lib/terminal-surface";
import { readSystemPalette, useSystemPalette } from "@/lib/use-system-palette";
import { GhosttyTerminalSurface } from "@/terminal/ghostty/surface";
import { ghosttyCursorStyle, ghosttyTheme, terminalFontFamily, terminalOwnsKey } from "@/lib/terminal-theme";
import { openLinkFrom, useLinkMenuItems } from "@/components/ChatLink";
import { ContextMenu } from "@/components/arc/context-menu/context-menu";
import { terminalLinkTarget } from "@/lib/terminal-links";
import { MessageSquarePlus, Plus, SquareTerminal, Trash2, X } from "@/components/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "@/client";
import { queueTerminalOperation } from "@/lib/terminal-lifecycle";
import { formatUnknownError } from "@/lib/format-error";
import { MAX_TERMINALS_PER_SESSION, terminalCount, useAppStore } from "@/store/app-store";
import type { TerminalPane } from "@/store/app-store";
import { translate } from "@/i18n";
import { cn } from "@/lib/cn";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { SplitDownIcon, SplitRightIcon } from "@/components/icons/SquareSplitIcons";
import { usePhoneSetting } from "@/lib/phone-prefs";

const actionButton = "rounded-[6px] p-1 text-text-muted transition-colors duration-[var(--motion-fast)] hover:bg-background-3 hover:text-text-primary disabled:pointer-events-none disabled:opacity-40";

export function TerminalTabsPane({ sessionId }: { sessionId: string }) {
  const workspace = useAppStore((state) => state.terminalWorkspacesBySession[sessionId]);
  const ensureTerminal = useAppStore((state) => state.ensureTerminal);
  const addTerminalTab = useAppStore((state) => state.addTerminalTab);
  const setActiveTerminal = useAppStore((state) => state.setActiveTerminal);
  const closeNow = useAppStore((state) => state.closeTerminal);
  // Chat behavior: closing a terminal can ask first, since its shell and history end.
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const closeTerminal = (owner: string, terminalId: string) => {
    if (useAppStore.getState().settings.confirmTerminalClose) setPendingClose(terminalId);
    else closeNow(owner, terminalId);
  };
  const splitTerminalPane = useAppStore((state) => state.splitTerminalPane);
  const moveTerminalToOwnPane = useAppStore((state) => state.moveTerminalToOwnPane);
  // Only the locale: unrelated settings changes must not re-render terminals.
  const locale = useAppStore((state) => state.settings.locale);
  const t = (key: string, params?: Record<string, string | number>) => translate(locale, key, params);

  const bootstrapped = useRef(false);
  useEffect(() => {
    if (!bootstrapped.current && (!workspace || workspace.panes.length === 0)) {
      bootstrapped.current = true;
      ensureTerminal(sessionId);
    }
  }, [workspace, ensureTerminal, sessionId]);

  const atLimit = terminalCount(workspace) >= MAX_TERMINALS_PER_SESSION;
  if (!workspace || workspace.panes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center" data-terminal>
        <button type="button" className="ui-control text-text-muted transition-colors duration-[var(--motion-fast)] hover:text-text-primary" onClick={() => ensureTerminal(sessionId)}>
          {t("New terminal")}
        </button>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col" data-terminal>
      <ConfirmDialog open={pendingClose !== null} onOpenChange={(open) => { if (!open) setPendingClose(null); }}
        title={t("chatBehavior.terminalTitle")} description={t("chatBehavior.terminalBody")} confirmLabel={t("chatBehavior.terminalClose")} cancelLabel={t("common.cancel")}
        onConfirm={() => { if (pendingClose) closeNow(sessionId, pendingClose); setPendingClose(null); }} />
      <div className={cn("flex h-full min-h-0", workspace.split === "columns" ? "flex-row" : "flex-col")}>
        {workspace.panes.map((pane, index) => (
          <div
            key={pane.id}
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col",
              index > 0 && (workspace.split === "columns" ? "border-l border-border-subtle" : "border-t border-border-subtle"),
            )}
          >
            <PaneHeader
              pane={pane}
              atLimit={atLimit}
              onAddTab={() => addTerminalTab(sessionId, pane.id)}
              onMoveToOwnPane={() => moveTerminalToOwnPane(sessionId, pane.id)}
              onSplitRight={() => splitTerminalPane(sessionId, pane.id, "columns")}
              onSplitDown={() => splitTerminalPane(sessionId, pane.id, "rows")}
              onCloseTerminal={() => closeTerminal(sessionId, pane.activeTerminalId)}
              onSelectTerminal={(terminalId) => setActiveTerminal(sessionId, pane.id, terminalId)}
              onCloseTab={(terminalId) => closeTerminal(sessionId, terminalId)}
            />
            <div className="relative min-h-0 flex-1">
              {pane.terminals.map((terminal) => (
                <TerminalInstance
                  key={terminal.id}
                  sessionId={sessionId}
                  terminalId={terminal.id}
                  visible={terminal.id === pane.activeTerminalId}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PaneHeader({
  pane,
  atLimit,
  onAddTab,
  onMoveToOwnPane,
  onSplitRight,
  onSplitDown,
  onCloseTerminal,
  onSelectTerminal,
  onCloseTab,
}: {
  pane: TerminalPane;
  atLimit: boolean;
  onAddTab: () => void;
  onMoveToOwnPane: () => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
  onCloseTerminal: () => void;
  onSelectTerminal: (terminalId: string) => void;
  onCloseTab: (terminalId: string) => void;
}) {
  // Only the locale: unrelated settings changes must not re-render terminals.
  const locale = useAppStore((state) => state.settings.locale);
  const t = (key: string, params?: Record<string, string | number>) => translate(locale, key, params);
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border-subtle px-1.5">
      <div className="scroll-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {pane.terminals.map((terminal) => {
          const active = terminal.id === pane.activeTerminalId;
          return (
            <div
              key={terminal.id}
              className={cn(
                "group flex h-6 shrink-0 items-center gap-1 rounded-[6px] pl-1.5 pr-1 ui-caption transition-colors duration-[var(--motion-fast)]",
                active ? "bg-background-3 text-text-primary" : "text-text-muted hover:bg-background-3/70 hover:text-text-secondary",
              )}
            >
              <button type="button" className="flex min-w-0 items-center gap-1.5" aria-pressed={active} onClick={() => onSelectTerminal(terminal.id)}>
                <SquareTerminal size={11} aria-hidden="true" />
                <span className="max-w-[140px] truncate">{t("Terminal {number}", { number: terminal.number })}</span>
              </button>
              <button
                type="button"
                aria-label={t("Close terminal")}
                title={t("Close terminal")}
                className="rounded-[4px] p-0.5 opacity-0 hover:bg-background-1 hover:text-text-primary group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => onCloseTab(terminal.id)}
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          aria-label={t("New terminal")}
          title={atLimit ? t("session reached the terminal limit") : t("New terminal")}
          disabled={atLimit}
          className={actionButton}
          onClick={onAddTab}
        >
          <Plus size={13} />
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {pane.terminals.length > 1 ? (
          <button type="button" aria-label={t("Move to its own tab")} title={t("Move to its own tab")} className={actionButton} onClick={onMoveToOwnPane}>
            <SquareTerminal size={13} />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={t("Split right")}
          title={atLimit ? t("session reached the terminal limit") : t("Split right")}
          disabled={atLimit}
          className={actionButton}
          onClick={onSplitRight}
        >
          <SplitRightIcon size={13} />
        </button>
        <button
          type="button"
          aria-label={t("Split down")}
          title={atLimit ? t("session reached the terminal limit") : t("Split down")}
          disabled={atLimit}
          className={actionButton}
          onClick={onSplitDown}
        >
          <SplitDownIcon size={13} />
        </button>
        <button type="button" aria-label={t("Close terminal")} title={t("Close terminal")} className={actionButton} onClick={onCloseTerminal}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

/**
 * A terminal outlives its view. Collapsing the dock, switching dock tabs or sessions, or
 * maximizing unmounts the view, but the shell keeps running (a dev server must survive a
 * glance elsewhere) and Ghostty keeps its screen: the view re-attaches the same element.
 * The shell stops only when its terminal is closed, its session is removed, or it is reopened.
 */
interface LiveTerminal {
  sessionId: string;
  /** Null until Ghostty's WebAssembly core and the fonts are ready. */
  surface: GhosttyTerminalSurface | null;
  element: HTMLDivElement;
  started: boolean;
  ended: boolean;
  error: string | null;
  attached: boolean;
  visible: boolean;
  view: { ended: (value: boolean) => void; error: (value: string | null) => void; selection: (value: string) => void; link: (url: string | null) => void; ready: () => void } | null;
  dispose: () => void;
}
const liveTerminals = new Map<string, LiveTerminal>();
let pruning: (() => void) | null = null;

function terminalListed(sessionId: string, terminalId: string) {
  return useAppStore.getState().terminalWorkspacesBySession[sessionId]?.panes.some((pane) => pane.terminals.some((terminal) => terminal.id === terminalId)) ?? false;
}

/** Stops terminals whose tab was closed or whose session was removed while no view showed them. */
function watchClosedTerminals() {
  if (pruning) return;
  let workspaces = useAppStore.getState().terminalWorkspacesBySession;
  pruning = useAppStore.subscribe((state) => {
    if (state.terminalWorkspacesBySession === workspaces) return;
    workspaces = state.terminalWorkspacesBySession;
    for (const [terminalId, live] of liveTerminals) if (!live.attached && !terminalListed(live.sessionId, terminalId)) live.dispose();
  });
}

function createLiveTerminal(sessionId: string, terminalId: string, host: HTMLElement, visible: boolean): LiveTerminal {
  watchClosedTerminals();
  const settings = useAppStore.getState().settings;
  const support = useAppStore.getState().hostInfo?.appearanceSupport;
  const element = document.createElement("div");
  element.className = "terminal-canvas relative h-full w-full";
  host.appendChild(element);
  // The link under the pointer, for the view's right-click menu (`live` exists by the time a link is hovered).
  const hoverLink = (uri: string | null) => live.view?.link(uri ? terminalLinkTarget(uri) : null);
  let disposed = false;
  let exited = false;
  const unlisteners: (() => void)[] = [];
  const live: LiveTerminal = {
    sessionId, surface: null, element, started: false, ended: false, error: null, attached: true, visible, view: null,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (liveTerminals.get(terminalId) === live) liveTerminals.delete(terminalId);
      useAppStore.getState().setTerminalRunning(sessionId, terminalId, false);
      unlisteners.forEach((unlisten) => unlisten());
      // Creation may still be in flight; it disposes its surface when it finds this terminal gone.
      live.surface?.dispose();
      live.surface = null;
      element.remove();
      void queueTerminalOperation(terminalId, () => client.stopTerminal(sessionId, terminalId)).catch((reason: unknown) => useAppStore.setState({ error: formatUnknownError(reason) }));
    },
  };
  liveTerminals.set(terminalId, live);
  // The store mirrors whether the shell runs, for the rows' terminal glyph (ADR-121).
  const markRunning = (value: boolean) => useAppStore.getState().setTerminalRunning(sessionId, terminalId, value);
  const setEnded = (value: boolean) => { live.ended = value; live.view?.ended(value); markRunning(live.started && !value && !disposed); };
  const report = (reason: unknown) => { if (disposed) return; live.error = formatUnknownError(reason); live.view?.error(live.error); };
  const created = GhosttyTerminalSurface.create(element, {
    theme: ghosttyTheme(terminalAppearance(settings, support, readSystemPalette())),
    font: { family: terminalFontFamily(settings.terminalFont), size: settings.terminalFontSize },
    visible,
    scrollback: settings.terminalScrollback,
    cursorStyle: ghosttyCursorStyle(settings.terminalCursorStyle),
    labels: { input: translate(settings.locale, "terminal.input"), scrollback: translate(settings.locale, "terminal.scrollback") },
    onData: (data) => { if (live.started) void client.writeTerminal(sessionId, terminalId, data).catch(report); },
    onResize: (cols, rows) => { if (live.started) void client.resizeTerminal(sessionId, terminalId, cols, rows).catch(report); },
    onSelectionChange: () => { if (!disposed) live.view?.selection(live.surface?.getSelection() ?? ""); },
    beforeKey: terminalOwnsKey,
    // http(s) addresses (localhost included) and OSC 8 hyperlinks open like links in replies
    // (ADR-149); the one under the pointer gives the right-click its link actions.
    canActivateLink: (text) => terminalLinkTarget(text) !== null,
    onLinkActivate: (text, event) => {
      const target = terminalLinkTarget(text);
      if (!target) return;
      event.preventDefault();
      void openLinkFrom(target, event);
    },
    onLinkHover: hoverLink,
  }).then((surface) => {
    if (disposed) { surface.dispose(); throw new Error("terminal closed"); }
    live.surface = surface;
    live.view?.ready();
    if (live.attached && live.visible) surface.focus();
    return surface;
  });
  created.catch(() => undefined);
  // The shell starts once its screen exists, so no early output is dropped.
  void queueTerminalOperation(terminalId, async () => {
    if (disposed) return;
    const surface = await created;
    if (disposed) return;
    // Register only after older cleanup has completed, before this spawn.
    for (const subscribe of [
      () => client.onPtyOutput((event) => { if (!disposed && event.sessionId === sessionId && event.terminalId === terminalId) live.surface?.write(event.data); }),
      () => client.onPtyExit((event) => { if (!disposed && event.sessionId === sessionId && event.terminalId === terminalId) { exited = true; live.started = false; setEnded(true); } }),
    ]) {
      const unlisten = await subscribe();
      if (disposed) { unlisten(); return; }
      unlisteners.push(unlisten);
    }
    if (disposed) return;
    await client.startTerminal(sessionId, terminalId, surface.cols, surface.rows);
    // A server started in the shell may now listen; the open views rescan once (ADR-151).
    useAppStore.getState().noteServerProcessStarted(sessionId);
    live.started = !exited;
    if (!disposed) { setEnded(exited); live.error = null; live.view?.error(null); surface.resendSize(); }
  }).catch((reason: unknown) => { if (!disposed) { report(reason); setEnded(true); } });
  return live;
}

function TerminalInstance({ sessionId, terminalId, visible }: { sessionId: string; terminalId: string; visible: boolean }) {
  const systemPalette = useSystemPalette();
  const host = useRef<HTMLDivElement>(null);
  // Select only what the terminal reads, so other settings changes leave it alone.
  const locale = useAppStore((state) => state.settings.locale);
  const terminalFont = useAppStore((state) => state.settings.terminalFont);
  const terminalFontSize = usePhoneSetting("terminalFontSize", useAppStore((state) => state.settings.terminalFontSize));
  const terminalCursorStyle = useAppStore((state) => state.settings.terminalCursorStyle);
  const terminalBackground = useAppStore((state) => terminalAppearance(state.settings, state.hostInfo?.appearanceSupport, systemPalette).background);
  const terminalGlass = useAppStore((state) => terminalTransparent(state.settings, state.hostInfo?.appearanceSupport, systemPalette));
  // What the surface around the terminal depends on: the dock's material changes with these.
  const surfaceKey = useAppStore((state) => {
    const material = resolveAppearanceMaterial(state.settings, state.hostInfo?.appearanceSupport, systemPalette);
    const session = state.sessions.find((row) => row.id === sessionId) ?? null;
    return `${material.palette}:${material.windowGlass}:${material.sidebarGlass}:${material.sidebarOpacity}:${isConversationStarted(session)}`;
  });
  const [generation, setGeneration] = useState(0);
  // Counts the moments the surface became ready: the effects below need it once it exists.
  const [ready, setReady] = useState(0);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  // Right-click on a link offers its actions; elsewhere the terminal keeps the native menu.
  // The link stays pinned while its menu is open, since the pointer leaves it for the menu.
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [menuUrl, setMenuUrl] = useState<string | null>(null);
  const linkItems = useLinkMenuItems(menuUrl ?? linkUrl);
  const linkMenuChanged = useCallback((open: boolean) => { if (!open) setMenuUrl(null); }, []);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const t = (key: string) => translate(locale, key);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let cancelled = false;
    let existing = liveTerminals.get(terminalId);
    if (existing && existing.sessionId !== sessionId) { existing.dispose(); existing = undefined; }
    const live = existing ?? createLiveTerminal(sessionId, terminalId, node, visibleRef.current);
    if (live === existing) node.appendChild(live.element);
    live.attached = true;
    live.visible = visibleRef.current;
    live.view = {
      ended: (value) => { if (!cancelled) setEnded(value); },
      error: (value) => { if (!cancelled) setError(value); },
      selection: (value) => { if (!cancelled) setSelected(value); },
      link: (value) => { if (!cancelled) setLinkUrl(value); },
      ready: () => { if (!cancelled) setReady((value) => value + 1); },
    };
    setEnded(live.ended);
    setError(live.error);
    // A re-attached screen was painted while detached: it measures its new place and draws again.
    if (live === existing && live.surface) { live.surface.setVisible(visibleRef.current); live.surface.resendSize(); }
    return () => {
      cancelled = true;
      live.view = null;
      live.attached = false;
      // Closed tabs stop their shell; any other unmount only detaches the view.
      if (!terminalListed(sessionId, terminalId)) live.dispose();
      else live.element.remove();
    };
  }, [sessionId, terminalId, generation]);

  // The font, size and cursor follow the settings; the font swaps in once its face settles.
  useEffect(() => {
    const surface = liveTerminals.get(terminalId)?.surface;
    if (!surface) return;
    surface.setCursorStyle(ghosttyCursorStyle(terminalCursorStyle));
    void surface.setFont({ family: terminalFontFamily(terminalFont), size: terminalFontSize });
  }, [terminalId, terminalFont, terminalFontSize, terminalCursorStyle, generation, ready]);

  useEffect(() => {
    const surface = liveTerminals.get(terminalId)?.surface;
    if (!surface) return;
    let cancelled = false;
    const appearance = terminalAppearance(useAppStore.getState().settings, useAppStore.getState().hostInfo?.appearanceSupport, systemPalette);
    surface.setTheme(ghosttyTheme(appearance));
    const frame = requestAnimationFrame(() => {
      // Paint the surface the terminal sits on (the dock's material), read once styles apply.
      const backgrounds: string[] = [];
      for (let node = host.current?.parentElement ?? null; node && backgrounds.length < 12; node = node.parentElement) backgrounds.push(getComputedStyle(node).backgroundColor);
      if (!cancelled) surface.setTheme(ghosttyTheme(appearance, terminalSurface(backgrounds, appearance.background)));
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [terminalId, terminalBackground, terminalGlass, systemPalette, surfaceKey, generation, ready]);

  useEffect(() => {
    const live = liveTerminals.get(terminalId);
    if (live) live.visible = visible;
    const surface = live?.surface;
    if (!surface) return;
    surface.setVisible(visible);
    if (!visible) return;
    const frame = requestAnimationFrame(() => surface.focus());
    return () => cancelAnimationFrame(frame);
  }, [terminalId, visible, generation, ready]);

  return (
    // Inactive tabs stay mounted (their shell and history live in Ghostty) but are skipped:
    // the surface stops drawing while hidden, and `visibility` + `content-visibility: hidden`
    // stop layout, paint and compositing, so writes to a background terminal cost only parsing.
    <div className={cn("absolute inset-0 flex flex-col transition-opacity duration-[var(--motion-fast)]", visible ? "opacity-100" : "pointer-events-none invisible opacity-0 [content-visibility:hidden]")} aria-hidden={!visible}>
      {error ? <p role="alert" className="p-2 ui-control text-danger">{error}</p> : null}
      {ended ? <button type="button" onClick={() => { liveTerminals.get(terminalId)?.dispose(); setGeneration((value) => value + 1); }} className="p-2 ui-control text-text-secondary">{t("terminal.reopen")}</button> : null}
      <ContextMenu activation="context-only" nativeWhenEmpty className="flex min-h-0 flex-1 flex-col" label={translate(locale, "link.actions", { url: menuUrl ?? linkUrl ?? "" })} items={linkItems} onOpenChange={linkMenuChanged}>
        <div ref={host} className="min-h-0 flex-1 p-1" onContextMenuCapture={() => setMenuUrl(linkUrl)} />
      </ContextMenu>
      {selected.trim() && visible ? <button type="button" className="terminal-add-to-chat" onMouseDown={(event) => event.preventDefault()} onClick={() => {
        // The selection becomes a Terminal chip in this session's composer as context.
        const state = useAppStore.getState(), owner = `session:${sessionId}`;
        const current = composerContextForOwner(owner, state.composerContexts, state.sessions);
        const text = selected.replace(/\s+$/, "").slice(0, MAX_SNIPPET);
        state.setComposerContext(owner, { ...current, snippets: [...(current.snippets ?? []), { id: crypto.randomUUID(), text }] });
        liveTerminals.get(terminalId)?.surface?.clearSelection();
        setSelected("");
      }}><MessageSquarePlus size={13} aria-hidden="true" />{t("Add to chat")}</button> : null}
    </div>
  );
}
