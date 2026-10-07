import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronLeft, CloudOff, FolderOpen, GitBranch, FileDiff, MoreHorizontal, Pencil, SquareTerminal, Trash2, X } from "@/components/icons/phosphor";
import { SessionPane } from "@/components/SessionPane";
import { useTranslation } from "@/i18n/use-translation";
import { useRetainedTranscripts } from "@/lib/use-retained-transcripts";
import { enqueueMessage, readOutbox, removeQueued, type QueuedMessage } from "@/lib/phone-outbox";
import { remoteReachable } from "@/client";
import { useAppStore } from "@/store/app-store";
import type { MobileNavigation } from "./MobileApp";
import { MobileDeleteDialog, MobileDialog, MobileMenu } from "./MobileDialog";

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
  const queued = useOutbox(sessionId);
  const [menu, setMenu] = useState(false);
  const [action, setAction] = useState<"rename" | "delete" | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  // As on the Mac, a conversation that is working cannot be deleted.
  const active = !!session && ["starting", "running", "waiting"].includes(session.status);
  const submit = async () => {
    if (!session || busy) return;
    setBusy(true);
    const store = useAppStore.getState();
    const done = await store.renameSession(session.id, title.trim());
    setBusy(false);
    if (done) setAction(null);
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
      { id: "git", label: t("mobile.git"), icon: <GitBranch size={16} />, onSelect: () => navigation.open({ kind: "git", sessionId }) },
      { id: "files", label: t("mobile.files"), icon: <FolderOpen size={16} />, onSelect: () => navigation.open({ kind: "files", sessionId }) },
      { id: "rename", label: t("session.rename"), icon: <Pencil size={16} />, onSelect: () => { setTitle(session?.title ?? ""); setAction("rename"); } },
      { id: "delete", label: t("session.delete"), icon: <Trash2 size={16} />, destructive: true, disabled: active, onSelect: () => setAction("delete") },
    ]} />
    <MobileDialog open={action === "rename"} title={t("session.rename")} onClose={() => { if (!busy) setAction(null); }}>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <input className="mobile-input" autoFocus value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} aria-label={t("session.titleOptional")} enterKeyHint="done" />
        <div className="mobile-dialog-actions">
          <button type="button" className="mobile-dialog-button" disabled={busy} onClick={() => setAction(null)}>{t("common.cancel")}</button>
          <button type="submit" className="mobile-dialog-button" data-tone="primary" disabled={busy || !title.trim()}>{t("common.save")}</button>
        </div>
      </form>
    </MobileDialog>
    <MobileDeleteDialog session={session ?? null} open={action === "delete"} onClose={() => setAction(null)} onDeleted={navigation.back} />
    {queued.length ? <div className="mobile-outbox" role="status">
      <CloudOff size={15} aria-hidden="true" />
      <div className="mobile-outbox-text">
        <strong>{t(queued.length === 1 ? "mobile.outboxOne" : "mobile.outboxMany", { count: queued.length })}</strong>
        {queued.map((item) => <span key={item.id} className="mobile-outbox-item"><span>{item.prompt}</span><button type="button" aria-label={t("mobile.outboxCancel")} onClick={() => removeQueued(item.id)}><X size={13} aria-hidden="true" /></button></span>)}
      </div>
    </div> : null}
    {selected ? <SessionPane
      agents={agents}
      onSend={(prompt, execution) => {
        // Out of reach of the Mac: the message waits on the phone and goes out on reconnect (ADR-086).
        if (!remoteReachable()) {
          enqueueMessage({ sessionId, prompt, execution });
          useAppStore.getState().setComposerDraft(`session:${sessionId}`, "");
          return Promise.resolve(true);
        }
        return sendPrompt(prompt, execution, sessionId);
      }}
      onStop={() => void stopAgent(sessionId)}
      onNewSession={() => navigation.open({ kind: "new", projectId: session?.projectId ?? null })}
      onModelChange={(provider, model) => void setSessionModel(provider, model, sessionId)}
    /> : <div className="flex-1" aria-busy="true" />}
  </div>;
}

/** This conversation's messages waiting on the phone for the Mac. */
function useOutbox(sessionId: string): QueuedMessage[] {
  const raw = useSyncExternalStore(
    (notify) => { window.addEventListener("sirus-outbox", notify); return () => window.removeEventListener("sirus-outbox", notify); },
    () => localStorage.getItem("sirus.outbox") ?? "[]",
  );
  return readOutbox({ getItem: () => raw, setItem: () => undefined }).filter((item) => item.sessionId === sessionId);
}
