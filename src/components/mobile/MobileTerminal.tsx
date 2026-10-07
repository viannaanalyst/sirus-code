import { ChevronLeft, Plus } from "@/components/icons/phosphor";
import { client } from "@/client";
import { TerminalTabsPane } from "@/components/TerminalPanel";
import { useTranslation } from "@/i18n/use-translation";
import { TERMINAL_KEYS } from "@/lib/mobile";
import { useAppStore } from "@/store/app-store";
import type { MobileNavigation } from "./MobileApp";

/** The session's real terminals, plus the keys a phone keyboard lacks. */
export function MobileTerminal({ sessionId, navigation }: { sessionId: string; navigation: MobileNavigation }) {
  const t = useTranslation();
  const session = useAppStore((state) => state.sessions.find((item) => item.id === sessionId));
  const project = useAppStore((state) => state.projects.find((item) => item.id === session?.projectId));
  const pane = useAppStore((state) => state.terminalWorkspacesBySession[sessionId]?.panes[0]);
  const send = (data: string) => {
    if (!pane) return;
    void client.writeTerminal(sessionId, pane.activeTerminalId, data).catch(() => undefined);
  };

  return <div className="mobile-page mobile-terminal">
    <header className="mobile-bar">
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.back")} onClick={navigation.back}><ChevronLeft size={18} aria-hidden="true" /></button>
      <div className="mobile-bar-title">
        <h1>{t("mobile.terminal")}</h1>
        <p>{project?.name}{session ? <> · <span className="mobile-row-branch">{session.worktree.branch}</span></> : null}</p>
      </div>
      {pane ? <button type="button" className="mobile-icon-button" aria-label={t("New terminal")} onClick={() => useAppStore.getState().addTerminalTab(sessionId, pane.id)}><Plus size={17} aria-hidden="true" /></button> : null}
    </header>
    <div className="mobile-terminal-body">
      <TerminalTabsPane sessionId={sessionId} />
    </div>
    <div className="mobile-keys" role="toolbar" aria-label={t("mobile.keys")}>
      {TERMINAL_KEYS.map((key) => <button key={key.label} type="button" onPointerDown={(event) => event.preventDefault()} onClick={() => send(key.data)}>{key.label}</button>)}
    </div>
  </div>;
}
