import { useEffect } from "react";
import { ChevronLeft, FileDiff, SquareTerminal } from "@/components/icons/phosphor";
import { SessionPane } from "@/components/SessionPane";
import { useTranslation } from "@/i18n/use-translation";
import { useRetainedTranscripts } from "@/lib/use-retained-transcripts";
import { useAppStore } from "@/store/app-store";
import type { MobileNavigation } from "./MobileApp";

/**
 * A conversation on the phone: the Mac's own transcript (timeline, approvals,
 * questions and composer) under a compact header with the terminal and the review.
 */
export function MobileChat({ sessionId, navigation }: { sessionId: string; navigation: MobileNavigation }) {
  const t = useTranslation();
  const session = useAppStore((state) => state.sessions.find((item) => item.id === sessionId));
  const project = useAppStore((state) => state.projects.find((item) => item.id === session?.projectId));
  const agents = useAppStore((state) => state.agents);
  const sendPrompt = useAppStore((state) => state.sendPrompt);
  const stopAgent = useAppStore((state) => state.stopAgent);
  const setSessionModel = useAppStore((state) => state.setSessionModel);
  const selected = useAppStore((state) => state.selectedSessionId === sessionId);
  useRetainedTranscripts([sessionId]);
  useEffect(() => { void useAppStore.getState().selectSession(sessionId); }, [sessionId]);

  return <div className="mobile-page mobile-chat">
    <header className="mobile-bar">
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.back")} onClick={navigation.back}><ChevronLeft size={18} aria-hidden="true" /></button>
      <div className="mobile-bar-title">
        <h1>{session?.title ?? ""}</h1>
        <p>{project?.name}{session ? <> · <span className="mobile-row-branch">{session.worktree.branch}</span></> : null}</p>
      </div>
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.terminal")} onClick={() => navigation.open({ kind: "terminal", sessionId })}><SquareTerminal size={17} aria-hidden="true" /></button>
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.review")} onClick={() => navigation.open({ kind: "review", sessionId })}><FileDiff size={17} aria-hidden="true" /></button>
    </header>
    {selected ? <SessionPane
      agents={agents}
      onSend={(prompt, execution) => sendPrompt(prompt, execution, sessionId)}
      onStop={() => void stopAgent(sessionId)}
      onNewSession={() => navigation.open({ kind: "new", projectId: session?.projectId ?? null })}
      onModelChange={(provider, model) => void setSessionModel(provider, model, sessionId)}
    /> : <div className="flex-1" aria-busy="true" />}
  </div>;
}
