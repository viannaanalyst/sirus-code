import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Keyboard, Plus, SquareTerminal } from "@/components/icons";
import { client } from "@/client";
import { TerminalTabsPane } from "@/components/TerminalPanel";
import { usePhoneTranslation as useTranslation } from "./use-phone-host";
import { TERMINAL_CLEAR, TERMINAL_KEYS, withTerminalModifier, type TerminalModifier } from "@/lib/mobile";
import { terminalRows } from "@/lib/phone-chat";
import { useAppStore } from "@/store/app-store";
import type { MobileNavigation } from "./MobileApp";
import { MobilePopover, type MobilePopoverItem } from "./MobilePopover";

const KEY_DATA: Record<string, string> = { Backspace: "\u007f", Enter: "\r", Tab: "\t", Escape: "\u001b", ArrowUp: "\u001b[A", ArrowDown: "\u001b[B", ArrowRight: "\u001b[C", ArrowLeft: "\u001b[D" };

/**
 * The conversation's real terminals on the phone, with the keys a phone keyboard lacks
 * (ADR-129): CMD and CTRL arm for the next key (from the row or the keyboard), paste,
 * clear, arrows, and a button that shows or hides the keyboard. The header switches terminals.
 */
export function MobileTerminal({ sessionId, navigation }: { sessionId: string; navigation: MobileNavigation }) {
  const t = useTranslation();
  const session = useAppStore((state) => state.sessions.find((item) => item.id === sessionId));
  const project = useAppStore((state) => state.projects.find((item) => item.id === session?.projectId));
  const workspace = useAppStore((state) => state.terminalWorkspacesBySession[sessionId]);
  const running = useAppStore((state) => state.runningTerminals[sessionId]);
  const pane = workspace?.panes[0];
  const body = useRef<HTMLDivElement>(null);
  const switcher = useRef<HTMLButtonElement>(null);
  const [switching, setSwitching] = useState(false);
  const [modifier, setModifier] = useState<TerminalModifier | null>(null);
  const [typing, setTyping] = useState(false);
  const canPaste = typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function";
  // The armed modifier and the target, read by the keyboard listeners without re-binding them.
  const live = useRef({ modifier, terminalId: pane?.activeTerminalId ?? null });
  live.current = { modifier, terminalId: pane?.activeTerminalId ?? null };

  const write = (data: string) => {
    const terminalId = live.current.terminalId;
    if (!terminalId || !data) return;
    void client.writeTerminal(sessionId, terminalId, data).catch(() => undefined);
  };
  const writeRef = useRef(write);
  writeRef.current = write;

  // A key typed on the phone keyboard while CMD or CTRL is armed goes out with it, once.
  useEffect(() => {
    const root = body.current;
    if (!root) return;
    const take = (event: Event, data: string) => {
      const armed = live.current.modifier;
      if (!armed) return;
      event.preventDefault();
      event.stopPropagation();
      writeRef.current(withTerminalModifier(data, armed));
      setModifier(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!live.current.modifier || event.isComposing) return;
      const data = event.key.length === 1 ? event.key : KEY_DATA[event.key];
      if (data) take(event, data);
    };
    // Some phone keyboards report "Unidentified" keys; their text still arrives here.
    const onBeforeInput = (event: InputEvent) => { if (event.data && !event.isComposing) take(event, event.data.slice(-1)); };
    const onFocus = () => setTyping(root.contains(document.activeElement) && document.activeElement instanceof HTMLTextAreaElement);
    let timer: number | undefined;
    const onBlur = () => { window.clearTimeout(timer); timer = window.setTimeout(onFocus, 0); };
    root.addEventListener("keydown", onKeyDown, true);
    root.addEventListener("beforeinput", onBeforeInput, true);
    root.addEventListener("focusin", onFocus);
    root.addEventListener("focusout", onBlur);
    return () => {
      window.clearTimeout(timer);
      root.removeEventListener("keydown", onKeyDown, true);
      root.removeEventListener("beforeinput", onBeforeInput, true);
      root.removeEventListener("focusin", onFocus);
      root.removeEventListener("focusout", onBlur);
    };
  }, []);

  const press = (key: (typeof TERMINAL_KEYS)[number]) => {
    if (key.kind === "modifier") { setModifier((current) => current === key.id ? null : key.id); return; }
    setModifier(null);
    if (key.kind === "clear") write(TERMINAL_CLEAR);
    else if (key.kind === "paste") void navigator.clipboard.readText().then(write, () => undefined);
    else write(withTerminalModifier(key.data, modifier));
  };
  const toggleKeyboard = () => {
    const field = body.current?.querySelector<HTMLTextAreaElement>(".terminal-input");
    if (!field) return;
    if (document.activeElement === field) field.blur(); else field.focus();
  };
  const openNew = () => {
    const store = useAppStore.getState();
    if (pane) store.addTerminalTab(sessionId, pane.id); else store.ensureTerminal(sessionId);
  };
  const items: MobilePopoverItem[] = [
    ...terminalRows(workspace, running).map((row) => ({ id: row.terminalId, icon: <SquareTerminal size={17} />, title: t("phoneChat.terminalNumber", { number: row.number }),
      subtitle: [t(row.running ? "phoneChat.terminalRunning" : "phoneChat.terminalReady"), project?.name].filter(Boolean).join(" · "),
      disabled: workspace?.panes.some((item) => item.id === row.paneId && item.activeTerminalId === row.terminalId),
      onSelect: () => useAppStore.getState().setActiveTerminal(sessionId, row.paneId, row.terminalId) })),
    { id: "new", icon: <Plus size={17} />, title: t("phoneChat.openTerminal"), subtitle: t("phoneChat.openTerminalHint"), onSelect: openNew },
  ];

  return <div className="mobile-page mobile-terminal">
    <header className="mobile-bar">
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.back")} onClick={navigation.back}><ChevronLeft size={18} aria-hidden="true" /></button>
      <div className="mobile-bar-title">
        <h1>{t("mobile.terminal")}</h1>
        <p>{project?.name}{session ? <> · <span className="mobile-row-branch">{session.worktree.branch}</span></> : null}</p>
      </div>
      <button ref={switcher} type="button" className="mobile-round-button mobile-glass mobile-terminal-switch" aria-label={t("phoneChat.switchTerminal")} aria-haspopup="menu" aria-expanded={switching} onClick={() => setSwitching(true)}><SquareTerminal size={18} aria-hidden="true" /></button>
    </header>
    <MobilePopover open={switching} anchor={switcher.current} label={t("phoneChat.terminal")} items={items} onClose={() => setSwitching(false)} />
    <div ref={body} className="mobile-terminal-body">
      <TerminalTabsPane sessionId={sessionId} />
    </div>
    <div className="mobile-keys" role="toolbar" aria-label={t("mobile.keys")}>
      <div className="mobile-keys-scroll">
        {TERMINAL_KEYS.filter((key) => key.kind !== "paste" || canPaste).map((key) => <button key={key.id} type="button" aria-label={t(`phoneChat.key.${key.id}`)}
          aria-pressed={key.kind === "modifier" ? modifier === key.id : undefined} data-kind={key.kind}
          onPointerDown={(event) => event.preventDefault()} onClick={() => press(key)}>{key.label}</button>)}
      </div>
      <button type="button" className="mobile-keys-keyboard" aria-label={t(typing ? "phoneChat.hideKeyboard" : "phoneChat.showKeyboard")} aria-pressed={typing}
        onPointerDown={(event) => event.preventDefault()} onClick={toggleKeyboard}><Keyboard size={18} aria-hidden="true" /></button>
    </div>
  </div>;
}
