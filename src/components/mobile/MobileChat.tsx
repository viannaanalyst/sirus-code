import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import type { Session } from "@/client/types";
import { ChevronDown, ChevronLeft, ChevronUp, CloudOff, Ellipsis, FileDiff, FolderOpen, GitBranch, GitCommitHorizontal, Play, Plus, SquareTerminal, X } from "@/components/icons/phosphor";
import { SessionPane } from "@/components/SessionPane";
import { PhoneComposerSlotContext } from "@/components/phone-composer-slot";
import { usePhoneTranslation as useTranslation } from "./use-phone-host";
import { useRetainedTranscripts } from "@/lib/use-retained-transcripts";
import { enqueueMessage, moveQueued, readOutbox, removeQueued, type QueuedMessage } from "@/lib/phone-outbox";
import { formatActivityDuration } from "@/lib/agent-activity";
import { gitMenuSummary, terminalRows } from "@/lib/phone-chat";
import { workingClock, workingSeconds } from "@/lib/phone-live";
import { remoteReachable } from "@/client";
import { environmentLabel } from "@/lib/environments";
import { formatUnknownError } from "@/lib/format-error";
import { continueTargets } from "@/lib/phone-continue";
import { useAppStore } from "@/store/app-store";
import { EnvironmentError, environmentOffline, useEnvironments } from "@/store/environments-store";
import type { MobileNavigation } from "./MobileApp";
import { MobileDialog } from "./MobileDialog";
import { MobilePopover, type MobilePopoverItem } from "./MobilePopover";
import { phoneComposerSlot } from "./PhoneComposerControls";

/**
 * A conversation on the phone: the Mac's own transcript (timeline, approvals, questions and
 * queue) under a header (ADR-129): back, the title (a tap renames)
 * and one glass pill with the terminal, files and Git menus. The composer is a single pill until
 * it is used, then grows with the model button that opens Thread settings.
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
  const page = useRef<HTMLDivElement>(null);
  const queued = useOutbox(sessionId);
  const continuing = useContinueElsewhere(sessionId, navigation);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!session || busy) return;
    setBusy(true);
    const store = useAppStore.getState();
    // Close at once and finish behind; a failure still shows as a toast.
    (document.activeElement as HTMLElement | null)?.blur();
    setRenaming(false);
    await store.renameSession(session.id, title.trim());
    setBusy(false);
  };

  const composer = useComposerShape(page, sessionId);
  const placeholder = t("phoneChat.placeholder");
  const slot = useMemo(() => phoneComposerSlot(placeholder, composer.setOverlay), [placeholder, composer.setOverlay]);

  // The working pill replaces the transcript's jump arrow while the agent runs.
  const working = !!session && workingClock(session) !== null;
  return <div ref={page} className="mobile-page mobile-chat" data-working={working || undefined} data-composer={composer.expanded ? "expanded" : "collapsed"}>
    <header className="mobile-bar mobile-chat-bar">
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.back")} onClick={navigation.back}><ChevronLeft size={18} aria-hidden="true" /></button>
      <button type="button" className="mobile-bar-title mobile-chat-title" aria-label={`${session?.title ?? ""} · ${t("phoneChat.renameHint")}`} disabled={!session} onClick={() => { setTitle(session?.title ?? ""); setRenaming(true); }}>
        <h1>{session?.title ?? ""}</h1>
        <p>{project?.name}{session ? <> · <span className="mobile-row-branch">{session.worktree.branch}</span></> : null}</p>
      </button>
      {session ? <MobileChatActions session={session} projectName={project?.name ?? ""} navigation={navigation} /> : null}
    </header>
    <MobileDialog open={renaming} title={t("session.rename")} onClose={() => setRenaming(false)}>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <input className="mobile-input" autoFocus value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} aria-label={t("session.titleOptional")} enterKeyHint="done" />
        <div className="mobile-dialog-actions">
          <button type="button" className="mobile-dialog-button" onClick={() => setRenaming(false)}>{t("common.cancel")}</button>
          <button type="submit" className="mobile-dialog-button" data-tone="primary" disabled={busy || !title.trim()}>{t("common.save")}</button>
        </div>
      </form>
    </MobileDialog>
    {queued.length || continuing.source ? <div className="mobile-outbox" role="status">
      <CloudOff size={15} aria-hidden="true" />
      <div className="mobile-outbox-text">
        <strong>{queued.length ? t(queued.length === 1 ? "mobile.outboxOne" : "mobile.outboxMany", { count: queued.length }) : t("continue.offline", { name: continuing.source ?? "" })}</strong>
        {queued.map((item, index) => <span key={item.id} className="mobile-outbox-item"><span>{item.prompt}</span>
          {queued.length > 1 ? <>
            <button type="button" aria-label={t("mobile.outboxUp")} disabled={index === 0} onClick={() => moveQueued(item.id, -1)}><ChevronUp size={13} aria-hidden="true" /></button>
            <button type="button" aria-label={t("mobile.outboxDown")} disabled={index === queued.length - 1} onClick={() => moveQueued(item.id, 1)}><ChevronDown size={13} aria-hidden="true" /></button>
          </> : null}
          <button type="button" aria-label={t("mobile.outboxCancel")} onClick={() => removeQueued(item.id)}><X size={13} aria-hidden="true" /></button></span>)}
        {continuing.targets.map((target) => <button key={target.id} type="button" className="mobile-outbox-continue" onClick={() => continuing.ask(target.id)}>{t("continue.button", { name: target.name })}</button>)}
      </div>
    </div> : null}
    <MobileDialog open={Boolean(continuing.asked)} title={t("continue.title", { name: continuing.asked?.name ?? "" })} onClose={continuing.cancel}>
      <p className="mobile-dialog-text">{t("continue.body", { name: continuing.asked?.name ?? "", branch: session?.worktree.branch ?? "main", source: continuing.source ?? "Mac" })}</p>
      {continuing.error ? <p className="mobile-dialog-text mobile-dialog-error" role="alert">{continuing.error}</p> : null}
      <div className="mobile-dialog-actions">
        <button type="button" className="mobile-dialog-button" disabled={continuing.busy} onClick={continuing.cancel}>{t("common.cancel")}</button>
        <button type="button" className="mobile-dialog-button" data-tone="primary" disabled={continuing.busy} onClick={() => void continuing.run()}>{t(continuing.busy ? "continue.working" : "continue.confirm")}</button>
      </div>
    </MobileDialog>
    <PhoneComposerSlotContext.Provider value={slot}>
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
    </PhoneComposerSlotContext.Provider>
    {selected && session ? <MobileWorkingPill session={session} page={page} /> : null}
  </div>;
}

/**
 * Whether the composer shows as a single pill or as the grown card: it grows while its field
 * has focus, holds a draft or attachment, or a menu or sheet of its own is open. Losing focus
 * waits a moment, so a tap on the model button lands before the card shrinks.
 */
function useComposerShape(page: RefObject<HTMLDivElement | null>, sessionId: string) {
  const [focused, setFocused] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const owner = `session:${sessionId}`;
  const filled = useAppStore((state) => {
    const context = state.composerContexts[owner];
    return Boolean((state.composerDrafts[owner] ?? "").trim() || context?.attachments.length || context?.snippets?.length);
  });
  useEffect(() => {
    const root = page.current;
    if (!root) return;
    let timer: number | undefined;
    const isField = (target: EventTarget | null) => target instanceof HTMLTextAreaElement && !!target.closest(".agent-composer");
    const onIn = (event: FocusEvent) => { if (isField(event.target)) { window.clearTimeout(timer); setFocused(true); } };
    const onOut = (event: FocusEvent) => { if (isField(event.target)) { window.clearTimeout(timer); timer = window.setTimeout(() => setFocused(false), 220); } };
    root.addEventListener("focusin", onIn);
    root.addEventListener("focusout", onOut);
    return () => { window.clearTimeout(timer); root.removeEventListener("focusin", onIn); root.removeEventListener("focusout", onOut); };
  }, [page]);
  return { expanded: focused || overlay || filled, setOverlay };
}

/** The header's glass pill: terminal, files and Git. */
function MobileChatActions({ session, projectName, navigation }: { session: Session; projectName: string; navigation: MobileNavigation }) {
  const t = useTranslation();
  const sessionId = session.id;
  const terminalButton = useRef<HTMLButtonElement>(null);
  const gitButton = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<"terminal" | "git" | null>(null);
  const status = useAppStore((state) => state.selectedSessionId === sessionId ? state.gitStatus : null);
  const workspace = useAppStore((state) => state.terminalWorkspacesBySession[sessionId]);
  const running = useAppStore((state) => state.runningTerminals[sessionId]);
  const scripts = useAppStore((state) => state.projects.find((item) => item.id === session.projectId)?.scripts);
  const openGit = () => { void useAppStore.getState().refreshGitStatus(); setMenu("git"); };

  const summary = gitMenuSummary(status);
  const branch = status?.identity.branch ?? session.worktree.branch;
  const gitItems: MobilePopoverItem[] = [
    { id: "branch", static: true, icon: <GitBranch size={17} />, title: branch || "—", subtitle: status ? summary.clean ? t("phoneChat.clean") : t("phoneChat.changed", { count: summary.changed }) : t("phoneChat.checking") },
    { id: "commit", icon: <GitCommitHorizontal size={17} />, title: t("phoneChat.commit"), disabled: !summary.canCommit, subtitle: summary.canCommit ? t("phoneChat.commitHint", { count: summary.changed }) : t("phoneChat.commitUpToDate"), onSelect: () => navigation.open({ kind: "review", sessionId }) },
    { id: "review", icon: <FileDiff size={17} />, title: t("phoneChat.reviewChanges"), subtitle: t("phoneChat.reviewHint"), onSelect: () => navigation.open({ kind: "review", sessionId }) },
    { id: "more", icon: <Ellipsis size={17} />, title: t("phoneChat.more"), subtitle: t("phoneChat.moreHint"), onSelect: () => navigation.open({ kind: "git", sessionId }) },
  ];

  // Project scripts run as on the Mac (ADR-078): in the conversation's own worktree, with their output above the composer.
  const scriptRunning = session.scripts?.runs?.some((run) => run.status === "running") ?? false;
  const saved = (["setup", "finish"] as const).flatMap((kind) => {
    const body = (kind === "setup" ? scripts?.setup : scripts?.onFinish)?.trim();
    return body ? [{ kind, body }] : [];
  });
  const scriptItems: MobilePopoverItem[] = saved.length
    ? saved.map(({ kind, body }) => ({ id: `script-${kind}`, icon: <Play size={17} />, title: t(`scripts.${kind}`),
      disabled: !session.worktree.isolated || !!session.sideChat || scriptRunning,
      subtitle: !session.worktree.isolated ? t("phoneChat.scriptIsolatedOnly") : scriptRunning ? t("phoneChat.scriptRunning") : body.split("\n").find((line) => line.trim())?.trim() ?? "",
      onSelect: () => void useAppStore.getState().projectScriptAction({ type: "run", sessionId, kind }) }))
    : [{ id: "no-scripts", icon: <Play size={17} />, title: t("phoneChat.noScripts"), subtitle: t("phoneChat.noScriptsHint"), disabled: true }];
  const terminalItems: MobilePopoverItem[] = [
    ...scriptItems,
    ...terminalRows(workspace, running).map((row) => ({ id: row.terminalId, icon: <SquareTerminal size={17} />, title: t("phoneChat.terminalNumber", { number: row.number }),
      subtitle: [t(row.running ? "phoneChat.terminalRunning" : "phoneChat.terminalReady"), projectName].filter(Boolean).join(" · "),
      onSelect: () => { useAppStore.getState().setActiveTerminal(sessionId, row.paneId, row.terminalId); navigation.open({ kind: "terminal", sessionId }); } })),
    { id: "new-terminal", icon: <Plus size={17} />, title: t("phoneChat.openTerminal"), subtitle: t("phoneChat.openTerminalHint"), onSelect: () => {
      const store = useAppStore.getState();
      const pane = store.terminalWorkspacesBySession[sessionId]?.panes[0];
      if (pane) store.addTerminalTab(sessionId, pane.id); else store.ensureTerminal(sessionId);
      navigation.open({ kind: "terminal", sessionId });
    } },
  ];

  return <>
    <div className="mobile-chat-actions mobile-glass" role="group" aria-label={t("phoneChat.headerActions")}>
      <button ref={terminalButton} type="button" aria-label={t("phoneChat.terminal")} aria-haspopup="menu" aria-expanded={menu === "terminal"} onClick={() => setMenu("terminal")}><SquareTerminal size={18} aria-hidden="true" /></button>
      <button type="button" aria-label={t("mobile.files")} onClick={() => navigation.open({ kind: "files", sessionId })}><FolderOpen size={18} aria-hidden="true" /></button>
      <button ref={gitButton} type="button" aria-label={t("phoneChat.git")} aria-haspopup="menu" aria-expanded={menu === "git"} onClick={openGit}><GitBranch size={18} aria-hidden="true" /></button>
    </div>
    <MobilePopover open={menu === "terminal"} anchor={terminalButton.current?.parentElement ?? null} label={t("phoneChat.terminal")} items={terminalItems} onClose={() => setMenu(null)} />
    <MobilePopover open={menu === "git"} anchor={gitButton.current?.parentElement ?? null} label={t("phoneChat.git")} items={gitItems} onClose={() => setMenu(null)} />
  </>;
}

/**
 * "Working · 42s" floating over the bottom of the transcript while the agent runs (ADR-124),
 * It sits where the transcript's jump arrow sits and does its job:
 * a tap follows the latest activity. Its own one-second clock runs only while the page shows.
 */
function MobileWorkingPill({ session, page }: { session: Session; page: RefObject<HTMLDivElement | null> }) {
  const t = useTranslation();
  const clock = workingClock(session);
  const startedAt = clock?.startedAt ?? null, pausedMs = clock?.pausedMs ?? 0;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // The transcript's bottom stack (requests, composer) owns this anchor; it is looked up
  // again whenever a turn starts, in case the transcript remounted.
  const live = startedAt !== null;
  useEffect(() => {
    if (live) setAnchor(page.current?.querySelector<HTMLElement>(".follow-latest-anchor") ?? null);
  }, [page, live]);
  useEffect(() => {
    if (startedAt === null) return;
    let timer: number | undefined;
    const schedule = () => {
      window.clearInterval(timer);
      timer = undefined;
      setNow(Date.now());
      if (!document.hidden) timer = window.setInterval(() => setNow(Date.now()), 1000);
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", schedule); };
  }, [startedAt]);
  const follow = () => {
    const root = page.current;
    const jump = root?.querySelector<HTMLButtonElement>(".follow-latest");
    if (jump) { jump.click(); return; }
    const scroller = root?.querySelector<HTMLElement>(".transcript-scroll");
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  if (!anchor?.isConnected) return null;
  const elapsed = startedAt === null ? null : formatActivityDuration(workingSeconds({ startedAt, pausedMs }, now));
  return createPortal(<AnimatePresence>
    {elapsed !== null ? <motion.button key="working" type="button" className="mobile-working-pill mobile-glass" onClick={follow}
      aria-label={t("mobile.workingPill", { duration: elapsed })}
      initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.97 }}>
      <span className="mobile-working-dot" aria-hidden="true" />
      <span>{t("mobile.working")}</span>
      <span className="mobile-working-time" aria-hidden="true">{elapsed}</span>
    </motion.button> : null}
  </AnimatePresence>, anchor);
}

/** This conversation's messages waiting on the phone for the Mac. */
/**
 * While the conversation's computer is off, the others that answer can take it (ADR-133
 * addendum): one button each in the waiting banner, a confirmation that says what goes along.
 */
function useContinueElsewhere(sessionId: string, navigation: MobileNavigation) {
  const t = useTranslation();
  const environments = useEnvironments((state) => state.environments);
  const connection = useEnvironments((state) => state.connection);
  const storeId = useEnvironments((state) => state.storeId);
  const switching = useEnvironments((state) => Boolean(state.switchingTo));
  const [asked, setAsked] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceEnvironment = environments.find((item) => item.id === storeId);
  const off = !switching && environmentOffline(connection[storeId]);
  const source = off && sourceEnvironment ? environmentLabel(sourceEnvironment, t("environments.computer")) : null;
  const targets = source ? continueTargets(environments, connection, storeId).map((item) => ({ id: item.id, name: environmentLabel(item, t("environments.computer")) })) : [];
  const ask = (id: string) => { setError(null); setAsked(targets.find((item) => item.id === id) ?? null); };
  const cancel = () => { if (!busy) setAsked(null); };
  const run = async () => {
    if (!asked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await useEnvironments.getState().continueOn(asked.id, sessionId);
      setAsked(null);
      navigation.replace({ kind: "chat", sessionId: created });
    } catch (reason) {
      setError(reason instanceof EnvironmentError ? t(reason.key) : formatUnknownError(reason));
    } finally {
      setBusy(false);
    }
  };
  return { source: targets.length ? source : null, targets, asked, busy, error, ask, cancel, run };
}

function useOutbox(sessionId: string): QueuedMessage[] {
  const raw = useSyncExternalStore(
    (notify) => { window.addEventListener("sirus-outbox", notify); return () => window.removeEventListener("sirus-outbox", notify); },
    () => localStorage.getItem("sirus.outbox") ?? "[]",
  );
  return readOutbox({ getItem: () => raw, setItem: () => undefined }).filter((item) => item.sessionId === sessionId);
}
