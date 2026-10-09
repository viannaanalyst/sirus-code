import { monoFontFamily } from "@/lib/fonts";
import { composerContextForOwner, MAX_SNIPPET } from "@/lib/composer-context";
import { terminalAppearance, terminalTransparent } from "@/lib/appearance";
import { readSystemPalette, useSystemPalette } from "@/lib/use-system-palette";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openLink } from "@/components/ChatMarkdown";
import { Terminal } from "@xterm/xterm";
import { MessageSquarePlus, Plus, SquareTerminal, Trash2, X } from "@/components/icons/phosphor";
import { useEffect, useRef, useState } from "react";
import { client } from "@/client";
import { queueTerminalOperation } from "@/lib/terminal-lifecycle";
import { formatUnknownError } from "@/lib/format-error";
import { MAX_TERMINALS_PER_SESSION, terminalCount, useAppStore } from "@/store/app-store";
import type { TerminalPane } from "@/store/app-store";
import { translate } from "@/i18n";
import { cn } from "@/lib/cn";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { SplitDownIcon, SplitRightIcon } from "@/components/icons/SquareSplitIcons";
import "@xterm/xterm/css/xterm.css";

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
      <div className="flex h-full items-center justify-center bg-[var(--main-material)]" data-terminal>
        <button type="button" className="ui-control text-text-muted transition-colors duration-[var(--motion-fast)] hover:text-text-primary" onClick={() => ensureTerminal(sessionId)}>
          {t("New terminal")}
        </button>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--main-material)]" data-terminal>
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
 * glance elsewhere) and xterm keeps its screen: the view re-attaches the same element.
 * The shell stops only when its terminal is closed, its session is removed, or it is reopened.
 */
interface LiveTerminal {
  sessionId: string;
  term: Terminal;
  fit: FitAddon;
  element: HTMLDivElement;
  started: boolean;
  ended: boolean;
  error: string | null;
  attached: boolean;
  view: { ended: (value: boolean) => void; error: (value: string | null) => void; selection: (value: string) => void } | null;
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

function createLiveTerminal(sessionId: string, terminalId: string, host: HTMLElement): LiveTerminal {
  watchClosedTerminals();
  const settings = useAppStore.getState().settings;
  const support = useAppStore.getState().hostInfo?.appearanceSupport;
  const element = document.createElement("div");
  element.className = "h-full w-full";
  host.appendChild(element);
  const term = new Terminal({
    convertEol: true,
    cursorBlink: true,
    cursorInactiveStyle: "outline",
    lineHeight: 1.15,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    // Transparency costs xterm a slower composite; only window glass needs it.
    allowTransparency: terminalTransparent(settings, support, readSystemPalette()),
    fontSize: settings.terminalFontSize,
    cursorStyle: settings.terminalCursorStyle === "bar" ? "bar" : settings.terminalCursorStyle === "underline" ? "underline" : "block",
    scrollback: settings.terminalScrollback,
    theme: terminalAppearance(settings, support, readSystemPalette()),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  // http(s) addresses (localhost included) open like links in replies.
  term.loadAddon(new WebLinksAddon((event, uri) => { event.preventDefault(); openLink(uri, event.metaKey); }));
  term.open(element);
  let disposed = false;
  let exited = false;
  const unlisteners: (() => void)[] = [];
  const live: LiveTerminal = {
    sessionId, term, fit, element, started: false, ended: false, error: null, attached: true, view: null,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (liveTerminals.get(terminalId) === live) liveTerminals.delete(terminalId);
      input.dispose();
      selection.dispose();
      unlisteners.forEach((unlisten) => unlisten());
      term.dispose();
      element.remove();
      void queueTerminalOperation(terminalId, () => client.stopTerminal(sessionId, terminalId)).catch((reason: unknown) => useAppStore.setState({ error: formatUnknownError(reason) }));
    },
  };
  liveTerminals.set(terminalId, live);
  const setEnded = (value: boolean) => { live.ended = value; live.view?.ended(value); };
  const report = (reason: unknown) => { if (disposed) return; live.error = formatUnknownError(reason); live.view?.error(live.error); };
  const selection = term.onSelectionChange(() => { if (!disposed) live.view?.selection(term.getSelection()); });
  const input = term.onData((data) => { if (live.started) void client.writeTerminal(sessionId, terminalId, data).catch(report); });
  void queueTerminalOperation(terminalId, async () => {
    if (disposed) return;
    // Register only after older cleanup has completed, before this spawn.
    for (const subscribe of [
      () => client.onPtyOutput((event) => { if (!disposed && event.sessionId === sessionId && event.terminalId === terminalId) term.write(event.data); }),
      () => client.onPtyExit((event) => { if (!disposed && event.sessionId === sessionId && event.terminalId === terminalId) { exited = true; live.started = false; setEnded(true); } }),
    ]) {
      const unlisten = await subscribe();
      if (disposed) { unlisten(); return; }
      unlisteners.push(unlisten);
    }
    if (disposed) return;
    await client.startTerminal(sessionId, terminalId, term.cols, term.rows);
    live.started = !exited;
    if (!disposed) { setEnded(exited); live.error = null; live.view?.error(null); }
  }).catch((reason: unknown) => { report(reason); if (!disposed) setEnded(true); });
  return live;
}

function TerminalInstance({ sessionId, terminalId, visible }: { sessionId: string; terminalId: string; visible: boolean }) {
  const systemPalette = useSystemPalette();
  const host = useRef<HTMLDivElement>(null);
  // Select only what the terminal reads, so other settings changes leave it alone.
  const locale = useAppStore((state) => state.settings.locale);
  const terminalFont = useAppStore((state) => state.settings.terminalFont);
  const terminalFontSize = useAppStore((state) => state.settings.terminalFontSize);
  const terminalCursorStyle = useAppStore((state) => state.settings.terminalCursorStyle);
  const terminalScrollback = useAppStore((state) => state.settings.terminalScrollback);
  const terminalBackground = useAppStore((state) => terminalAppearance(state.settings, state.hostInfo?.appearanceSupport, systemPalette).background);
  const terminalGlass = useAppStore((state) => terminalTransparent(state.settings, state.hostInfo?.appearanceSupport, systemPalette));
  const terminal = useRef<Terminal | null>(null);
  const refit = useRef<(() => void) | null>(null);
  const [generation, setGeneration] = useState(0);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const t = (key: string) => translate(locale, key);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let cancelled = false;
    let existing = liveTerminals.get(terminalId);
    if (existing && existing.sessionId !== sessionId) { existing.dispose(); existing = undefined; }
    const live = existing ?? createLiveTerminal(sessionId, terminalId, node);
    if (live === existing) node.appendChild(live.element);
    live.attached = true;
    live.view = { ended: (value) => { if (!cancelled) setEnded(value); }, error: (value) => { if (!cancelled) setError(value); }, selection: (value) => { if (!cancelled) setSelected(value); } };
    setEnded(live.ended);
    setError(live.error);
    const { term, fit } = live;
    terminal.current = term;
    const safeFit = () => {
      if (cancelled || !node.isConnected || node.clientWidth < 2 || node.clientHeight < 2) return;
      fit.fit();
    };
    const resize = () => {
      if (cancelled || !visibleRef.current) return;
      safeFit();
      if (live.started) void client.resizeTerminal(sessionId, terminalId, term.cols, term.rows).catch((reason: unknown) => { if (!cancelled) setError(formatUnknownError(reason)); });
    };
    safeFit();
    // A re-attached screen was painted while detached; draw it again in place.
    if (live === existing) { term.refresh(0, term.rows - 1); resize(); }
    refit.current = resize;
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
      live.view = null;
      live.attached = false;
      if (terminal.current === term) terminal.current = null;
      if (refit.current === resize) refit.current = null;
      // Closed tabs stop their shell; any other unmount only detaches the view.
      if (!terminalListed(sessionId, terminalId)) live.dispose();
      else live.element.remove();
    };
  }, [sessionId, terminalId, generation]);

  useEffect(() => {
    const term = terminal.current;
    if (!term) return;
    let cancelled = false;
    term.options.fontSize = terminalFontSize;
    term.options.cursorStyle = terminalCursorStyle === "bar" ? "bar" : terminalCursorStyle === "underline" ? "underline" : "block";
    term.options.scrollback = terminalScrollback;
    term.options.allowTransparency = terminalGlass;
    term.options.theme = terminalAppearance(useAppStore.getState().settings, useAppStore.getState().hostInfo?.appearanceSupport, systemPalette);
    const fit = () => { if (!cancelled && terminal.current === term) refit.current?.(); };
    const frame = requestAnimationFrame(fit);
    // Set the new family only once its face settles, so xterm measures loaded glyphs.
    // The public font option triggers measurement without restarting the owned PTY.
    const applyFont = () => {
      if (cancelled || terminal.current !== term) return;
      term.options.fontFamily = monoFontFamily(terminalFont);
      fit();
    };
    void document.fonts.load(`${terminalFontSize}px ${monoFontFamily(terminalFont)}`).then(applyFont).catch(applyFont);
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [terminalFont, terminalFontSize, terminalCursorStyle, terminalScrollback, terminalBackground, terminalGlass, systemPalette, generation]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      refit.current?.();
      terminal.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  return (
    // Inactive tabs stay mounted (their shell and history live in xterm) but are skipped:
    // `visibility` + `content-visibility: hidden` stop layout, paint and compositing of
    // their rows, so writes to a background terminal cost only parsing.
    <div className={cn("absolute inset-0 flex flex-col transition-opacity duration-[var(--motion-fast)]", visible ? "opacity-100" : "pointer-events-none invisible opacity-0 [content-visibility:hidden]")} aria-hidden={!visible}>
      {error ? <p role="alert" className="p-2 ui-control text-danger">{error}</p> : null}
      {ended ? <button type="button" onClick={() => { liveTerminals.get(terminalId)?.dispose(); setGeneration((value) => value + 1); }} className="p-2 ui-control text-text-secondary">{t("terminal.reopen")}</button> : null}
      <div ref={host} className="min-h-0 flex-1 p-2" />
      {selected.trim() && visible ? <button type="button" className="terminal-add-to-chat" onMouseDown={(event) => event.preventDefault()} onClick={() => {
        // The selection becomes a Terminal chip in this session's composer (T3-style context).
        const state = useAppStore.getState(), owner = `session:${sessionId}`;
        const current = composerContextForOwner(owner, state.composerContexts, state.sessions);
        const text = selected.replace(/\s+$/, "").slice(0, MAX_SNIPPET);
        state.setComposerContext(owner, { ...current, snippets: [...(current.snippets ?? []), { id: crypto.randomUUID(), text }] });
        terminal.current?.clearSelection();
        setSelected("");
      }}><MessageSquarePlus size={13} aria-hidden="true" />{t("Add to chat")}</button> : null}
    </div>
  );
}
