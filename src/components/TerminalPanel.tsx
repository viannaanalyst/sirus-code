import { monoFontFamily } from "@/lib/fonts";
import { terminalAppearance } from "@/lib/appearance";
import { readSystemPalette, useSystemPalette } from "@/lib/use-system-palette";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Plus, SquareTerminal, Trash2, X } from "@/components/icons/phosphor";
import { useEffect, useRef, useState } from "react";
import { client } from "@/client";
import { queueTerminalOperation } from "@/lib/terminal-lifecycle";
import { formatUnknownError } from "@/lib/format-error";
import { MAX_TERMINALS_PER_SESSION, terminalCount, useAppStore } from "@/store/app-store";
import type { TerminalPane } from "@/store/app-store";
import { translate } from "@/i18n";
import { cn } from "@/lib/cn";
import { SplitDownIcon, SplitRightIcon } from "@/components/icons/SquareSplitIcons";
import "@xterm/xterm/css/xterm.css";

const actionButton = "rounded-[6px] p-1 text-text-muted transition-colors duration-[var(--motion-fast)] hover:bg-background-3 hover:text-text-primary disabled:pointer-events-none disabled:opacity-40";

export function TerminalTabsPane({ sessionId }: { sessionId: string }) {
  const workspace = useAppStore((state) => state.terminalWorkspacesBySession[sessionId]);
  const ensureTerminal = useAppStore((state) => state.ensureTerminal);
  const addTerminalTab = useAppStore((state) => state.addTerminalTab);
  const setActiveTerminal = useAppStore((state) => state.setActiveTerminal);
  const closeTerminal = useAppStore((state) => state.closeTerminal);
  const splitTerminalPane = useAppStore((state) => state.splitTerminalPane);
  const moveTerminalToOwnPane = useAppStore((state) => state.moveTerminalToOwnPane);
  const settings = useAppStore((state) => state.settings);
  const t = (key: string, params?: Record<string, string | number>) => translate(settings.locale, key, params);

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
      <div className="flex h-full items-center justify-center bg-background-0" data-terminal>
        <button type="button" className="ui-control text-text-muted transition-colors duration-[var(--motion-fast)] hover:text-text-primary" onClick={() => ensureTerminal(sessionId)}>
          {t("New terminal")}
        </button>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-background-0" data-terminal>
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
  const settings = useAppStore((state) => state.settings);
  const t = (key: string, params?: Record<string, string | number>) => translate(settings.locale, key, params);
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

function TerminalInstance({ sessionId, terminalId, visible }: { sessionId: string; terminalId: string; visible: boolean }) {
  const systemPalette = useSystemPalette();
  const host = useRef<HTMLDivElement>(null);
  const settings = useAppStore((state) => state.settings);
  const appearanceSupport = useAppStore(state => state.hostInfo?.appearanceSupport);
  const { background: terminalBackground, foreground: terminalForeground, cursor: terminalCursor } = terminalAppearance(settings, appearanceSupport, systemPalette);
  const options = useRef(settings);
  options.current = settings;
  const terminal = useRef<Terminal | null>(null);
  const refit = useRef<(() => void) | null>(null);
  const [generation, setGeneration] = useState(0);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const t = (key: string) => translate(settings.locale, key);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const settings = options.current;
    let cancelled = false;
    let started = false;
    let exited = false;
    const unlisteners: (() => void)[] = [];
    const term = new Terminal({
      convertEol: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      allowTransparency: true,
      fontSize: settings.terminalFontSize,
      cursorStyle: settings.terminalCursorStyle === "bar" ? "bar" : settings.terminalCursorStyle === "underline" ? "underline" : "block",
      scrollback: settings.terminalScrollback,
      theme: terminalAppearance(settings, useAppStore.getState().hostInfo?.appearanceSupport, readSystemPalette()),
    });
    terminal.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(node);
    const safeFit = () => {
      if (cancelled || !node.isConnected || node.clientWidth < 2 || node.clientHeight < 2) return;
      fit.fit();
    };
    safeFit();
    const report = (reason: unknown) => { if (!cancelled) setError(formatUnknownError(reason)); };
    const input = term.onData((data) => { if (started) void client.writeTerminal(sessionId, terminalId, data).catch(report); });
    const setup = async () => {
      try {
        await queueTerminalOperation(terminalId, async () => {
          if (cancelled) return;
          // Register only after older cleanup has completed, before this spawn.
          for (const subscribe of [
            () => client.onPtyOutput((event) => { if (!cancelled && event.sessionId === sessionId && event.terminalId === terminalId) term.write(event.data); }),
            () => client.onPtyExit((event) => { if (!cancelled && event.sessionId === sessionId && event.terminalId === terminalId) { exited = true; started = false; setEnded(true); } }),
          ]) {
            const unlisten = await subscribe();
            if (cancelled) { unlisten(); return; }
            unlisteners.push(unlisten);
          }
          if (cancelled) return;
          await client.startTerminal(sessionId, terminalId, term.cols, term.rows);
          started = !exited;
          if (!cancelled) { setEnded(exited); setError(null); }
        });
      } catch (reason) { report(reason); if (!cancelled) setEnded(true); }
    };
    void setup();
    const resize = () => {
      if (cancelled || !visibleRef.current) return;
      safeFit();
      if (started) void client.resizeTerminal(sessionId, terminalId, term.cols, term.rows).catch(report);
    };
    refit.current = resize;
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => {
      cancelled = true;
      input.dispose();
      observer.disconnect();
      unlisteners.forEach((unlisten) => unlisten());
      term.dispose();
      if (terminal.current === term) terminal.current = null;
      if (refit.current === resize) refit.current = null;
      void queueTerminalOperation(terminalId, () => client.stopTerminal(sessionId, terminalId)).catch((reason: unknown) => useAppStore.setState({ error: formatUnknownError(reason) }));
    };
  }, [sessionId, terminalId, generation]);

  useEffect(() => {
    const term = terminal.current;
    if (!term) return;
    let cancelled = false;
    term.options.fontSize = settings.terminalFontSize;
    term.options.cursorStyle = settings.terminalCursorStyle === "bar" ? "bar" : settings.terminalCursorStyle === "underline" ? "underline" : "block";
    term.options.scrollback = settings.terminalScrollback;
    term.options.theme = { background: terminalBackground, foreground: terminalForeground, cursor: terminalCursor };
    const fit = () => { if (!cancelled && terminal.current === term) refit.current?.(); };
    const frame = requestAnimationFrame(fit);
    // Set the new family only once its face settles, so xterm measures loaded glyphs.
    // The public font option triggers measurement without restarting the owned PTY.
    const applyFont = () => {
      if (cancelled || terminal.current !== term) return;
      term.options.fontFamily = monoFontFamily(settings.terminalFont);
      fit();
    };
    void document.fonts.load(`${settings.terminalFontSize}px ${monoFontFamily(settings.terminalFont)}`).then(applyFont).catch(applyFont);
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [settings.terminalFont, settings.terminalFontSize, settings.terminalCursorStyle, settings.terminalScrollback, terminalBackground, terminalForeground, terminalCursor, generation]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      refit.current?.();
      terminal.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  return (
    <div className={cn("absolute inset-0 flex flex-col transition-opacity duration-[var(--motion-fast)]", visible ? "opacity-100" : "pointer-events-none opacity-0")} aria-hidden={!visible}>
      {error ? <p role="alert" className="p-2 ui-control text-danger">{error}</p> : null}
      {ended ? <button type="button" onClick={() => setGeneration((value) => value + 1)} className="p-2 ui-control text-text-secondary">{t("terminal.reopen")}</button> : null}
      <div ref={host} className="min-h-0 flex-1 p-2" />
    </div>
  );
}
