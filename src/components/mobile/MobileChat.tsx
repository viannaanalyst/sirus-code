import { useEffect, useRef, useState } from "react";
import { ChevronLeft, FileDiff, MoreHorizontal, Pencil, SquareTerminal, Trash2 } from "@/components/icons/phosphor";
import { SessionPane } from "@/components/SessionPane";
import { useTranslation } from "@/i18n/use-translation";
import { useRetainedTranscripts } from "@/lib/use-retained-transcripts";
import { useAppStore } from "@/store/app-store";
import { Checkbox } from "@/components/arc/checkbox/checkbox";
import type { MobileNavigation } from "./MobileApp";
import { MobileDialog, MobileMenu } from "./MobileDialog";

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
  // Startup (a tapped alert) can restore another selection after this page opened; keep ours.
  useEffect(() => { if (!selected) void useAppStore.getState().selectSession(sessionId); }, [selected, sessionId]);
  const more = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const [action, setAction] = useState<"rename" | "delete" | null>(null);
  const [title, setTitle] = useState("");
  const [removeWorktree, setRemoveWorktree] = useState(false);
  const [busy, setBusy] = useState(false);
  // As on the Mac, a conversation that is working cannot be deleted.
  const active = !!session && ["starting", "running", "waiting"].includes(session.status);
  const submit = async () => {
    if (!session || busy) return;
    setBusy(true);
    const store = useAppStore.getState();
    const done = action === "rename" ? await store.renameSession(session.id, title.trim()) : await store.deleteSession(session.id, removeWorktree);
    setBusy(false);
    if (!done) return;
    setAction(null);
    if (action === "delete") navigation.back();
  };

  return <div className="mobile-page mobile-chat">
    <header className="mobile-bar">
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.back")} onClick={navigation.back}><ChevronLeft size={18} aria-hidden="true" /></button>
      <div className="mobile-bar-title">
        <h1>{session?.title ?? ""}</h1>
        <p>{project?.name}{session ? <> · <span className="mobile-row-branch">{session.worktree.branch}</span></> : null}</p>
      </div>
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.terminal")} onClick={() => navigation.open({ kind: "terminal", sessionId })}><SquareTerminal size={17} aria-hidden="true" /></button>
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.review")} onClick={() => navigation.open({ kind: "review", sessionId })}><FileDiff size={17} aria-hidden="true" /></button>
      <button ref={more} type="button" className="mobile-icon-button" aria-label={t("mobile.more")} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(true)}><MoreHorizontal size={18} aria-hidden="true" /></button>
    </header>
    <MobileMenu open={menu} anchor={more.current} onClose={() => setMenu(false)} items={[
      { id: "rename", label: t("session.rename"), icon: <Pencil size={16} />, onSelect: () => { setTitle(session?.title ?? ""); setAction("rename"); } },
      { id: "delete", label: t("session.delete"), icon: <Trash2 size={16} />, destructive: true, disabled: active, onSelect: () => { setRemoveWorktree(false); setAction("delete"); } },
    ]} />
    <MobileDialog open={action !== null} title={t(action === "rename" ? "session.rename" : "session.delete")} onClose={() => { if (!busy) setAction(null); }}>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {action === "rename"
          ? <input className="mobile-input" autoFocus value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} aria-label={t("session.titleOptional")} enterKeyHint="done" />
          : <p className="mobile-help mobile-dialog-text">{t("session.deleteHelp")}</p>}
        {action === "delete" && session?.worktree.isolated ? <div className="mobile-dialog-option"><Checkbox label={t("session.removeWorktree")} checked={removeWorktree} onCheckedChange={(value) => setRemoveWorktree(value === true)} disabled={busy} /></div> : null}
        <div className="mobile-dialog-actions">
          <button type="button" className="mobile-dialog-button" disabled={busy} onClick={() => setAction(null)}>{t("common.cancel")}</button>
          <button type="submit" className="mobile-dialog-button" data-tone={action === "delete" ? "danger" : "primary"} disabled={busy || (action === "rename" && !title.trim())}>{t(action === "rename" ? "common.save" : "session.delete")}</button>
        </div>
      </form>
    </MobileDialog>
    {selected ? <SessionPane
      agents={agents}
      onSend={(prompt, execution) => sendPrompt(prompt, execution, sessionId)}
      onStop={() => void stopAgent(sessionId)}
      onNewSession={() => navigation.open({ kind: "new", projectId: session?.projectId ?? null })}
      onModelChange={(provider, model) => void setSessionModel(provider, model, sessionId)}
    /> : <div className="flex-1" aria-busy="true" />}
  </div>;
}
