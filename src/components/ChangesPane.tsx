import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, GitBranch, LoaderCircle, Minus, Plus, RefreshCw, Sparkles } from "@/components/icons/phosphor";
import { client, type SwitchyardClient } from "@/client";
import type { FileChange, GitWorkspaceEntry, GitWorkspaceSnapshot } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { useAppStore } from "@/store/app-store";
import { formatUnknownError } from "@/lib/format-error";
import { CommitTitleRequest } from "@/lib/commit-title";
import { IconButton } from "@/primitives/IconButton";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/primitives/Dropdown";
import { fileIconFor } from "@/lib/file-icons";
import { DiffViewer } from "./DiffViewer";
import { GitHistory } from "./GitHistory";
import "@/styles/changes.css";

type Api = Pick<SwitchyardClient, "gitWorkspace" | "gitWorkspaceDiff" | "gitCommit" | "gitPush" | "gitCommitTitle" | "cancelCommitTitle"> & Partial<Pick<SwitchyardClient, "gitWorkspaceHistory">>;
type Props = { sessionId: string; workspacePath: string; api?: Api };
type Selection = { entry: GitWorkspaceEntry; staged: boolean };

/** Session/workspace remount makes obsolete reads and writes unable to populate another view. */
export function ChangesPane(props: Props) {
  return <WorkspaceChanges key={`${props.sessionId}:${props.workspacePath}`} {...props} />;
}
function WorkspaceChanges({ sessionId, api = client }: Props) {
  const t = useTranslation();
  const showUntracked = useAppStore(state => state.settings.gitShowUntracked);
  const [snapshot, setSnapshot] = useState<GitWorkspaceSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [confirmPush, setConfirmPush] = useState(false);
  const alive = useRef(false), gate = useRef(false), reads = useRef(0), diffs = useRef(0), messageRevision = useRef(0);
  const [generating, setGenerating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [attribution, setAttribution] = useState<import("@/client/types").CommitTitleResult | null>(null);
  const request = useRef<CommitTitleRequest | null>(null);
  const currentIndex = useRef<string | null>(null);
  const titleId = useId();
  const [older, setOlder] = useState<{ head: string; entries: import("@/client/types").GitHistoryEntry[]; truncated: boolean } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const publish = useCallback((value: GitWorkspaceSnapshot) => {
    currentIndex.current = value.indexToken; setAttribution(null); setOlder(null);
    setSnapshot(value); setSelection(null); setDiff(null); setDiffError(null); diffs.current++;
  }, []);
  const refresh = useCallback(async () => {
    if (gate.current) return;
    const revision = ++reads.current;
    gate.current = true; setBusy(true); setError(null);
    try {
      const value = await api.gitWorkspace({ type: "snapshot", sessionId });
      if (alive.current && reads.current === revision) publish(value);
    } catch (reason) { if (alive.current && reads.current === revision) { setError(formatUnknownError(reason)); setSnapshot(null); } }
    finally { if (alive.current && reads.current === revision) { gate.current = false; setBusy(false); } }
  }, [api, sessionId, publish]);
  useEffect(() => {
    alive.current = true; gate.current = false; diffs.current++;
    void refresh();
    return () => { alive.current = false; void request.current?.cancel().catch(() => {}); };
  }, [refresh]);

  const run = async (operation: "stage" | "unstage" | "commit" | "push", paths: string[] = []): Promise<boolean> => {
    if (gate.current || !snapshot) return false;
    gate.current = true; setBusy(true); setError(null); setNotice(null);
    const capturedMessage = message, revision = messageRevision.current;
    // Invalidate in-flight diff reads before changing the index.
    diffs.current++; setSelection(null); setDiff(null); setDiffError(null);
    try {
      if (operation === "stage" || operation === "unstage") {
        const next = await api.gitWorkspace({ type: operation, sessionId, paths, expectedIndex: snapshot.indexToken });
        if (alive.current) publish(next);
      } else {
        if (operation === "commit") {
          const result = await api.gitCommit(sessionId, capturedMessage, snapshot.indexToken);
          if (!alive.current) return false;
          if (messageRevision.current === revision) { setMessage(""); messageRevision.current++; }
          setNotice(t("workspaceGit.committed", { hash: result.hash.slice(0, 8) }));
        } else {
          const result = await api.gitPush(sessionId);
          if (!alive.current) return false;
          setNotice(t("Pushed {branch}", { branch: result.branch }));
          setConfirmPush(false);
        }
        // Refresh the shared Environment view only for this still-selected owner.
        // Its existing sequence/session guards also reject late publications.
        const store = useAppStore.getState();
        if (alive.current && store.selectedSessionId === sessionId) void store.refreshGitStatus();
        const next = await api.gitWorkspace({ type: "snapshot", sessionId });
        if (alive.current) publish(next);
      }
      return true;
    } catch (reason) { if (alive.current) { setError(formatUnknownError(reason)); setSnapshot(null); } return false; }
    finally { if (alive.current) { gate.current = false; setBusy(false); } }
  };
  const generateTitle = async () => {
    if (gate.current || !snapshot) return;
    gate.current = true; setBusy(true); setGenerating(true); setCancelling(false); setError(null); setNotice(null); setAttribution(null);
    const job = new CommitTitleRequest(api, sessionId, snapshot.indexToken, crypto.randomUUID(), messageRevision.current);
    request.current = job;
    const outcome = await job.generate(() => ({ sessionId, index: currentIndex.current, revision: messageRevision.current, alive: alive.current && request.current === job }));
    if (!alive.current || request.current !== job) return;
    if (outcome.type === "title") { setMessage(outcome.result.title); messageRevision.current++; setAttribution(outcome.result); }
    else if (outcome.type === "error") setError(formatUnknownError(outcome.reason));
    else setNotice(t(outcome.type === "discarded" ? "workspaceGit.titlePreserved" : "workspaceGit.titleCancelled"));
    request.current = null; gate.current = false; setBusy(false); setGenerating(false); setCancelling(false);
  };
  const cancelTitle = async () => {
    const job = request.current;
    if (!job || cancelling) return;
    setCancelling(true);
    try { await job.cancel(); }
    catch (reason) { if (alive.current && request.current === job) setError(formatUnknownError(reason)); }
  };
  // Older pages continue from the exact commit this snapshot loaded, never from a moved HEAD.
  const loadOlder = async () => {
    const from = snapshot?.head;
    if (!from || loadingOlder || !api.gitWorkspaceHistory) return;
    setLoadingOlder(true);
    try {
      const skip = snapshot.history.length + (older?.head === from ? older.entries.length : 0);
      const page = await api.gitWorkspaceHistory(sessionId, from, skip);
      if (alive.current && currentIndex.current === snapshot.indexToken) setOlder(previous => ({ head: from, entries: [...(previous?.head === from ? previous.entries : []), ...page.entries].slice(0, 5000), truncated: page.truncated }));
    } catch (reason) { if (alive.current) setError(formatUnknownError(reason)); }
    finally { if (alive.current) setLoadingOlder(false); }
  };
  const select = async (entry: GitWorkspaceEntry, staged: boolean) => {
    if (!snapshot || gate.current) return;
    const revision = ++diffs.current;
    setSelection({ entry, staged }); setDiff(null); setDiffError(null);
    try {
      const value = await api.gitWorkspaceDiff(sessionId, entry.path, staged, snapshot.indexToken);
      if (alive.current && diffs.current === revision) setDiff(value);
    } catch (reason) { if (alive.current && diffs.current === revision) setDiffError(formatUnknownError(reason)); }
  };
  const blocked = busy || !snapshot?.identity.isRepo || snapshot.truncated || snapshot.conflicts;
  const commitBlocked = blocked || !!snapshot?.outsideScope || !snapshot?.staged.length || snapshot.staged.some(file => !file.actionable);
  const pushBlocked = busy || !snapshot?.identity.isRepo || !snapshot.head || snapshot.identity.detached;
  const fileGroups = snapshot?.identity.isRepo ? [
    { staged: true, label: "workspaceGit.staged", entries: snapshot.staged },
    { staged: false, label: "workspaceGit.unstaged", entries: snapshot.unstaged.filter(file => showUntracked || file.kind !== "untracked") },
  ] : [];
  const nothing = Boolean(snapshot?.identity.isRepo) && fileGroups.every(group => !group.entries.length);
  const selected: FileChange | null = selection ? { path: selection.entry.path, kind: selection.entry.kind, additions: 0, deletions: 0 } : null;
  const commit = async () => { if (!commitBlocked && message.trim()) await run("commit"); };
  // Commit, then the usual Push confirmation: pushing is never implicit.
  const commitAndPush = async () => { if (await run("commit")) setConfirmPush(true); };
  return <section className="changes-pane flex h-full min-h-0 flex-col" aria-label={t("Changes")}>
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
      <GitBranch size={14} aria-hidden="true" className="shrink-0 text-text-muted" />
      <span className="min-w-0 truncate ui-control text-text-primary">{snapshot?.identity.branch ?? t("Changes")}</span>
      {snapshot?.identity.isRepo && snapshot.ahead !== null && snapshot.behind !== null ? <span className="shrink-0 ui-micro text-text-muted" title={t("workspaceGit.counts", { ahead: snapshot.ahead, behind: snapshot.behind })}>↑{snapshot.ahead} ↓{snapshot.behind}</span> : null}
      <span className="flex-1" />
      <IconButton label={t("workspaceGit.refresh")} disabled={busy} onClick={() => void refresh()} className="size-7 min-h-0"><RefreshCw size={13} /></IconButton>
    </div>
    {snapshot?.identity.isRepo === false ? <p role="status" className="p-3 ui-caption text-text-muted">{t("workspaceGit.notRepo")}</p> : <div className="shrink-0 space-y-2 border-b border-border-subtle p-3">
      <div className="changes-message">
        <input id={titleId} aria-label={t("workspaceGit.title")} placeholder={t("workspaceGit.messagePlaceholder")} value={message} maxLength={200}
          onChange={event => { messageRevision.current++; setAttribution(null); setNotice(null); setMessage(event.target.value); }}
          onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void commit(); } }} />
        <span className="changes-sparkle">{generating
          ? <IconButton label={t(cancelling ? "workspaceGit.cancelling" : "workspaceGit.cancelTitle")} disabled={cancelling} onClick={() => void cancelTitle()} className="size-[26px] min-h-0 rounded-[6px] p-0"><LoaderCircle size={14} className="animate-spin" aria-hidden="true" /></IconButton>
          : <IconButton label={`${t("workspaceGit.generate")} · ${t("workspaceGit.generationHint")}`} disabled={commitBlocked} onClick={() => void generateTitle()} className="size-[26px] min-h-0 rounded-[6px] p-0 text-text-muted"><Sparkles size={14} aria-hidden="true" /></IconButton>}</span>
      </div>
      <div className="changes-commit">
        <button type="button" className="changes-commit-main ui-control" disabled={commitBlocked || !message.trim()} onClick={() => void commit()}><Check size={14} aria-hidden="true" />{t("Commit")}</button>
        <Dropdown>
          <DropdownTrigger asChild><button type="button" className="changes-commit-more" aria-label={t("workspaceGit.moreActions")} disabled={busy}><ChevronDown size={14} aria-hidden="true" /></button></DropdownTrigger>
          <DropdownContent align="end">
            <DropdownItem disabled={commitBlocked || !message.trim()} onSelect={() => void commitAndPush()}>{t("workspaceGit.commitAndPush")}</DropdownItem>
            <DropdownItem disabled={pushBlocked} onSelect={() => setConfirmPush(true)}>{t("workspaceGit.pushOnly")}</DropdownItem>
          </DropdownContent>
        </Dropdown>
      </div>
      {attribution ? <p role="status" className="ui-micro text-text-muted">{t("workspaceGit.titleProvider", { provider: attribution.provider === "codex" ? "Codex" : "Claude" })}{attribution.partial ? ` · ${t("workspaceGit.titlePartial")}` : ""}</p> : null}
      {snapshot?.truncated ? <p role="status" className="ui-caption text-warning">{t("workspaceGit.truncated")}</p> : null}
      {snapshot?.conflicts ? <p role="status" className="ui-caption text-warning">{t("workspaceGit.conflicts")}</p> : null}
      {snapshot?.outsideScope ? <p role="status" className="ui-caption text-warning">{t("workspaceGit.outside")}</p> : null}
      {error ? <p role="alert" className="ui-caption text-danger">{t(error)}</p> : null}
      {notice ? <p role="status" className="ui-caption text-success">{notice}</p> : null}
    </div>}
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto py-1">
      {!snapshot && busy ? <p role="status" className="px-3 py-2 ui-caption text-text-muted">{t("workspaceGit.loading")}</p> : null}
      {nothing ? <p className="px-3 py-2 ui-control text-text-muted">{t("workspaceGit.noChanges")}</p> : null}
      {fileGroups.filter(group => group.entries.length).map(group => <div key={group.label} className="changes-group">
        <div className="changes-group-head">
          <h3 className="ui-caption">{t(group.label)} <span className="text-text-muted">{group.entries.length}</span></h3>
          <IconButton label={t(group.staged ? "workspaceGit.unprepareAll" : "workspaceGit.prepareAll")} disabled={blocked || !group.entries.some(entry => entry.actionable)} onClick={() => void run(group.staged ? "unstage" : "stage", group.entries.filter(entry => entry.actionable).map(entry => entry.path))} className="size-6 min-h-0">{group.staged ? <Minus size={13} /> : <Plus size={13} />}</IconButton>
        </div>
        {group.entries.map(entry => {
          const open = selection?.entry.path === entry.path && selection.staged === group.staged;
          const slash = entry.path.lastIndexOf("/");
          const name = entry.path.slice(slash + 1), dir = slash >= 0 ? entry.path.slice(0, slash) : "";
          const icon = fileIconFor(name);
          return <div key={entry.path}>
            <div className="changes-row" data-open={open || undefined}>
              <button type="button" disabled={busy} onClick={() => { if (open) { diffs.current++; setSelection(null); setDiff(null); setDiffError(null); } else void select(entry, group.staged); }} aria-expanded={open}
                className="changes-row-main" title={entry.actionable ? entry.path : `${entry.path} — ${t("workspaceGit.unavailable")}`}>
                <icon.Icon size={13} style={{ color: icon.color }} className="shrink-0" aria-hidden="true" />
                <span className="truncate ui-control text-text-primary">{name}</span>
                {dir ? <span className="min-w-0 truncate ui-micro text-text-muted">{dir}</span> : null}
              </button>
              <IconButton label={t(group.staged ? "workspaceGit.unprepare" : "workspaceGit.prepare", { path: entry.path })} disabled={blocked || !entry.actionable} onClick={() => void run(group.staged ? "unstage" : "stage", [entry.path])} className="changes-row-action size-6 min-h-0">{group.staged ? <Minus size={13} /> : <Plus size={13} />}</IconButton>
              <span className="changes-kind ui-micro" data-kind={entry.conflicted ? "conflicted" : entry.kind} title={t(entry.conflicted ? "workspaceGit.conflicted" : `change.${entry.kind}`)}>{entry.conflicted ? "!" : entry.kind === "untracked" ? "U" : entry.kind.charAt(0).toUpperCase()}</span>
            </div>
            {open && selected ? <div className="changes-diff">
              {diffError ? <p role="alert" className="p-3 ui-caption text-danger">{t(diffError)}</p> : <DiffViewer hideFileList changes={[selected]} selected={selected} diff={diff} onSelect={() => {}} />}
            </div> : null}
          </div>;
        })}
      </div>)}
    </div>
    {snapshot?.identity.isRepo ? <GitHistory entries={older?.head === snapshot.head ? [...snapshot.history, ...older.entries] : snapshot.history} truncated={older?.head === snapshot.head ? older.truncated : snapshot.historyTruncated} onLoadMore={api.gitWorkspaceHistory && snapshot.head ? () => void loadOlder() : undefined} loading={loadingOlder} /> : null}
    <ConfirmDialog open={confirmPush} onOpenChange={setConfirmPush} busy={busy} destructive={false} title={t("Confirm push")} description={t("workspaceGit.pushDescription")} confirmLabel={t(busy ? "Pushing…" : "Confirm push")} onConfirm={() => run("push")}>
      {error ? <p role="alert" className="mb-3 ui-caption text-danger">{t(error)}</p> : null}
    </ConfirmDialog>
  </section>;
}
