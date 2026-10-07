import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, ChevronDown, CircleAlert, CircleCheck, CircleDashed, CircleMinus, Copy, ExternalLink, GitCommitHorizontal, GitMerge, MessageSquare, Wrench, GitPullRequestDraft, GitPullRequestClosed, RotateCcw } from "@/components/icons/phosphor";
import { client } from "@/client";
import type { FileChange, GithubDetail, GithubItem, GithubMergeMethod } from "@/client/types";
import { DiffViewer } from "@/components/DiffViewer";
import { ItemStateIcon } from "@/components/pull-requests/ItemStateIcon";
import { PrWatchList } from "@/components/PrWatch";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";
import { formatUnknownError } from "@/lib/format-error";
import { agentDraft, mergeBlocker, splitDiff } from "@/lib/github-inbox";
import { watchesFor } from "@/lib/pull-requests";
import { relativeTime } from "@/lib/session-board";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/primitives/Dropdown";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { useAppStore } from "@/store/app-store";

type Tab = "summary" | "timeline" | "code";
type Pending =
  | { type: "merge"; method: GithubMergeMethod }
  | { type: "setDraft"; draft: boolean }
  | { type: "setOpen"; open: boolean };

const METHOD_LABEL: Record<GithubMergeMethod, string> = { squash: "pulls.method.squash", merge: "pulls.method.merge", rebase: "pulls.method.rebase" };

export function PullRequestDetail({ item, projectIds, onChanged }: { item: GithubItem; projectIds: string[]; onChanged: () => void }) {
  const t = useTranslation();
  const [detail, setDetail] = useState<GithubDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [method, setMethod] = useState<GithubMergeMethod | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [fixing, setFixing] = useState(false);
  const isPull = item.kind === "pullRequest";
  const allWatches = useAppStore((store) => store.prWatches);
  const watches = useMemo(() => isPull ? watchesFor(allWatches, item.repository, item.number) : [], [allWatches, isPull, item.repository, item.number]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await client.pullRequestAction({ type: "detail", repository: item.repository, number: item.number, kind: item.kind });
      if (response.type === "detail") setDetail(response);
    } catch (reason) { setError(formatUnknownError(reason)); }
  }, [item.repository, item.number, item.kind]);
  useEffect(() => { void load(); }, [load]);

  const view = detail?.item ?? item;
  const chosen = method && detail?.mergeMethods.includes(method) ? method : detail?.mergeMethods[0] ?? "squash";
  const blocker = detail && isPull ? mergeBlocker(detail) : null;

  const run = async (next: Pending) => {
    const store = useAppStore.getState();
    const base = { repository: item.repository, number: item.number, confirm: true as const };
    const response = next.type === "merge"
      ? await store.pullRequestAction({ type: "merge", ...base, method: next.method, expectedHead: detail?.headOid ?? "" })
      : next.type === "setDraft"
        ? await store.pullRequestAction({ type: "setDraft", ...base, draft: next.draft })
        : await store.pullRequestAction({ type: "setOpen", ...base, kind: item.kind, open: next.open });
    if (!response) return false;
    await load();
    onChanged();
    return true;
  };

  const sendToAgent = async (purpose: "work" | "fix" | "conflicts") => {
    if (!detail || !projectIds[0] || fixing) return;
    const store = useAppStore.getState();
    const projectId = projectIds[0];
    // Fixing starts from what GitHub reported for every failing check; if that
    // lookup fails the draft still lists the failing check names.
    let failures = null;
    if (purpose === "fix" && detail.checks.some((check) => check.status === "failed")) {
      setFixing(true);
      const response = await client.pullRequestAction({ type: "failures", repository: item.repository, number: item.number }).catch(() => null);
      setFixing(false);
      if (response?.type === "failures") failures = response;
    }
    void store.selectProject(projectId).then(() => {
      const next = useAppStore.getState();
      next.setMainView("session");
      next.requestNewSession();
      next.setComposerDraft(`project:${projectId}`, agentDraft(detail, purpose, failures));
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`textarea[data-draft-owner="project:${projectId}"]`)?.focus());
    });
  };

  const confirmCopy = pending ? confirmText(pending, view, t) : null;
  const failing = detail?.checks.some((check) => check.status === "failed") || detail?.reviews.some((review) => review.state === "CHANGES_REQUESTED");
  const conflicting = view.mergeable === "CONFLICTING" || detail?.mergeStateStatus === "DIRTY";

  return <div className="pulls-detail">
    <header className="pulls-detail-header">
      <div className="flex items-start gap-2">
        <span className="mt-1 shrink-0"><ItemStateIcon item={view} size={18} /></span>
        <h2 className="ui-title min-w-0 flex-1 text-text-primary [overflow-wrap:anywhere]">{view.title} <span className="text-text-muted">#{view.number}</span></h2>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 ui-caption text-text-muted">
        <span>{view.repository}</span>
        {view.author ? <span>· {t("pulls.by", { author: view.author })}</span> : null}
        {view.headRef ? <span className="font-mono">· {view.headRef} → {view.baseRef}</span> : null}
        {isPull ? <span>· <span className="pulls-add">+{view.additions}</span> <span className="pulls-del">−{view.deletions}</span></span> : null}
        <span>· {t(`pulls.itemState.${view.isDraft && view.state === "open" ? "draft" : view.state}`)}</span>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {isPull && view.state === "open" ? (view.isDraft
          ? <InteractiveButton variant="secondary" glow={false} disabled={!detail} onClick={() => setPending({ type: "setDraft", draft: false })}>{t("pulls.ready")}</InteractiveButton>
          : <div className="pulls-split" title={blocker ? t(blocker) : undefined}>
            <InteractiveButton variant="primary" glow={false} disabled={!detail || !!blocker} onClick={() => setPending({ type: "merge", method: chosen })}><GitMerge size={14} />{t(METHOD_LABEL[chosen])}</InteractiveButton>
            <Dropdown>
              <DropdownTrigger asChild><button type="button" className="pulls-split-arrow" disabled={!detail || (detail.mergeMethods.length ?? 0) < 2} aria-label={t("pulls.mergeMethod")}><ChevronDown size={13} /></button></DropdownTrigger>
              <DropdownContent align="end" side="bottom">{detail?.mergeMethods.map((value) => <DropdownItem key={value} onSelect={() => setMethod(value)}>{t(METHOD_LABEL[value])}</DropdownItem>)}</DropdownContent>
            </Dropdown>
          </div>) : null}
        {blocker && isPull && view.state === "open" && !view.isDraft ? <span className="inline-flex items-center gap-1 ui-caption text-text-muted"><CircleAlert size={12} />{t(blocker)}</span> : null}
        <span className="flex-1" />
        <InteractiveButton variant="toolbar" disabled={!detail || !projectIds.length} onClick={() => void sendToAgent("work")}><Bot size={14} />{t("pulls.sendToAgent")}</InteractiveButton>
        <InteractiveButton variant="toolbar" onClick={() => void client.openExternalUrl(view.url).catch((reason: unknown) => useAppStore.setState({ error: formatUnknownError(reason) }))}><ExternalLink size={14} />{t("pulls.openOnGithub")}</InteractiveButton>
        <Dropdown>
          <DropdownTrigger asChild><button type="button" className="pulls-more ui-control" aria-label={t("pulls.more")}>···</button></DropdownTrigger>
          <DropdownContent align="end" side="bottom">
            <DropdownItem icon={<Copy size={15} />} onSelect={() => void navigator.clipboard.writeText(view.url)}>{t("pulls.copyLink")}</DropdownItem>
            {isPull && view.state === "open" && failing ? <DropdownItem icon={<Wrench size={15} />} disabled={!projectIds.length || fixing} onSelect={() => void sendToAgent("fix")}>{t("pulls.fixFindings")}</DropdownItem> : null}
            {isPull && view.state === "open" && conflicting ? <DropdownItem icon={<GitMerge size={15} />} disabled={!projectIds.length} onSelect={() => void sendToAgent("conflicts")}>{t("pulls.resolveConflicts")}</DropdownItem> : null}
            <DropdownSeparator />
            {isPull && view.state === "open" && !view.isDraft ? <DropdownItem icon={<GitPullRequestDraft size={15} />} disabled={!detail} onSelect={() => setPending({ type: "setDraft", draft: true })}>{t("pulls.toDraft")}</DropdownItem> : null}
            {view.state === "open" ? <DropdownItem icon={<GitPullRequestClosed size={15} />} destructive onSelect={() => setPending({ type: "setOpen", open: false })}>{t(isPull ? "pulls.closePull" : "pulls.closeIssue")}</DropdownItem> : null}
            {view.state === "closed" ? <DropdownItem icon={<RotateCcw size={15} />} onSelect={() => setPending({ type: "setOpen", open: true })}>{t(isPull ? "pulls.reopenPull" : "pulls.reopenIssue")}</DropdownItem> : null}
          </DropdownContent>
        </Dropdown>
      </div>
      <div className="pulls-detail-tabs" role="tablist">
        {(isPull ? ["summary", "timeline", "code"] as const : ["summary", "timeline"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value} className="pulls-tab ui-control" onClick={() => setTab(value)}>{t(`pulls.tab.${value}`)}</button>)}
      </div>
    </header>
    <div className="scroll-thin pulls-detail-body">
      {error ? <p role="alert" className="ui-description text-danger">{t(error)}</p> : null}
      {!detail && !error ? <p role="status" className="ui-description text-text-muted">{t("common.loading")}</p> : null}
      {tab === "summary" ? <PrWatchList watches={watches} /> : null}
      {detail && tab === "summary" ? <Summary detail={detail} onFixChecks={isPull && view.state === "open" && projectIds.length ? () => void sendToAgent("fix") : undefined} fixing={fixing} /> : null}
      {detail && tab === "timeline" ? <Timeline detail={detail} onCommented={() => { void load(); onChanged(); }} /> : null}
      {detail && tab === "code" ? <Code item={item} /> : null}
    </div>
    <ConfirmDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null); }}
      title={confirmCopy?.title ?? ""} description={confirmCopy?.description} confirmLabel={confirmCopy?.confirm ?? ""}
      destructive={pending?.type === "setOpen" && !pending.open}
      onConfirm={() => pending ? run(pending) : false} />
  </div>;
}

function confirmText(pending: Pending, item: GithubItem, t: (key: string, values?: Record<string, string | number>) => string) {
  const ref = `${item.repository}#${item.number}`;
  if (pending.type === "merge") return { title: t("pulls.confirm.mergeTitle", { ref }), description: t("pulls.confirm.mergeBody", { method: t(METHOD_LABEL[pending.method]), base: item.baseRef ?? "" }), confirm: t(METHOD_LABEL[pending.method]) };
  if (pending.type === "setDraft") return pending.draft
    ? { title: t("pulls.confirm.draftTitle", { ref }), description: t("pulls.confirm.draftBody"), confirm: t("pulls.toDraft") }
    : { title: t("pulls.confirm.readyTitle", { ref }), description: t("pulls.confirm.readyBody"), confirm: t("pulls.ready") };
  return pending.open
    ? { title: t("pulls.confirm.reopenTitle", { ref }), description: t("pulls.confirm.reopenBody"), confirm: t("pulls.reopen") }
    : { title: t("pulls.confirm.closeTitle", { ref }), description: t("pulls.confirm.closeBody"), confirm: t("pulls.close") };
}

const CHECK_ICON = { passed: CircleCheck, failed: CircleAlert, pending: CircleDashed, skipped: CircleMinus, unknown: CircleDashed } as const;

function Summary({ detail, onFixChecks, fixing }: { detail: GithubDetail; onFixChecks?: () => void; fixing: boolean }) {
  const t = useTranslation();
  const latest = new Map<string, string>();
  for (const review of detail.reviews) if (review.author && review.state !== "COMMENTED") latest.set(review.author, review.state);
  return <div className="flex flex-col gap-5">
    <div className="whitespace-pre-wrap ui-body text-text-secondary [overflow-wrap:anywhere] selectable">{detail.body.trim() || <span className="text-text-muted">{t("pulls.noDescription")}</span>}</div>
    {detail.item.labels.length ? <div className="flex flex-wrap gap-1">{detail.item.labels.map((label) => <span key={label.name} className="pulls-label ui-caption" style={label.color ? { borderColor: `#${label.color}` } : undefined}>{label.name}</span>)}</div> : null}
    {detail.checks.length ? <Block title={t("pulls.checksTitle", { passed: detail.checks.filter((check) => check.status === "passed").length, total: detail.checks.length })} action={onFixChecks && detail.checks.some((check) => check.status === "failed") ? <button type="button" className="pulls-fix-checks ui-caption" disabled={fixing} onClick={onFixChecks}><Wrench size={12} />{t(fixing ? "pulls.fixingChecks" : "pulls.fixChecks")}</button> : null}>
      {detail.checks.map((check, index) => { const Icon = CHECK_ICON[check.status]; return <div key={`${check.name}:${index}`} className="flex items-center gap-2 py-1 ui-control">
        <Icon size={14} className={cn(check.status === "passed" && "pulls-open", check.status === "failed" && "pulls-closed", check.status !== "passed" && check.status !== "failed" && "text-text-muted")} />
        <span className="min-w-0 flex-1 truncate">{check.name}</span>
        {check.url ? <button type="button" className="text-text-muted hover:text-text-primary" aria-label={t("pulls.openCheck", { name: check.name })} onClick={() => void client.openExternalUrl(check.url!).catch(() => undefined)}><ExternalLink size={12} /></button> : null}
      </div>; })}
    </Block> : null}
    {(detail.reviewers.length || latest.size) ? <Block title={t("pulls.reviewers")}>
      {[...latest].map(([author, state]) => <div key={author} className="flex items-center justify-between py-1 ui-control"><span>{author}</span><span className={cn("ui-caption", state === "APPROVED" ? "pulls-open" : state === "CHANGES_REQUESTED" ? "pulls-closed" : "text-text-muted")}>{t(`pulls.review.${state}`)}</span></div>)}
      {detail.reviewers.filter((name) => !latest.has(name)).map((name) => <div key={name} className="flex items-center justify-between py-1 ui-control"><span>{name}</span><span className="ui-caption text-text-muted">{t("pulls.review.REQUESTED")}</span></div>)}
    </Block> : null}
    {detail.item.assignees.length ? <Block title={t("pulls.assignees")}><p className="ui-control">{detail.item.assignees.join(", ")}</p></Block> : null}
    {detail.files.length ? <Block title={t("pulls.filesTitle", { count: detail.changedFiles || detail.files.length })}>
      {detail.files.map((file) => <div key={file.path} className="flex items-center gap-2 py-0.5 ui-caption"><span className="min-w-0 flex-1 truncate font-mono text-text-secondary">{file.path}</span><span className="pulls-add">+{file.additions}</span><span className="pulls-del">−{file.deletions}</span></div>)}
      {detail.filesTruncated ? <p className="pt-1 ui-caption text-text-muted">{t("pulls.filesTruncated")}</p> : null}
    </Block> : null}
  </div>;
}

function Block({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section><div className="mb-1.5 flex items-center justify-between gap-2"><h3 className="ui-section-title text-text-muted">{title}</h3>{action}</div><div className="rounded-[10px] border border-border-subtle px-3 py-2">{children}</div></section>;
}

function Timeline({ detail, onCommented }: { detail: GithubDetail; onCommented: () => void }) {
  const t = useTranslation();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const events = useMemo(() => [
    ...detail.commits.map((commit) => ({ at: commit.committedAt ?? "", key: `c:${commit.oid}`, node: <div className="flex items-center gap-2 ui-control text-text-secondary"><GitCommitHorizontal size={14} className="shrink-0 text-text-muted" /><span className="min-w-0 flex-1 truncate">{commit.headline}</span><span className="font-mono ui-caption text-text-muted">{commit.oid.slice(0, 7)}</span></div> })),
    ...detail.reviews.map((review, index) => ({ at: review.submittedAt ?? "", key: `r:${index}`, node: <Entry author={review.author} at={review.submittedAt} badge={t(`pulls.review.${review.state}`)} body={review.body} /> })),
    ...detail.comments.map((comment, index) => ({ at: comment.createdAt, key: `m:${index}`, node: <Entry author={comment.author} at={comment.createdAt} body={comment.body} /> })),
  ].sort((a, b) => a.at.localeCompare(b.at)), [detail, t]);
  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    // The explicit Comment click is the confirmation for this one change.
    const response = await useAppStore.getState().pullRequestAction({ type: "comment", repository: detail.item.repository, number: detail.item.number, body, confirm: true });
    setBusy(false);
    if (response) { setText(""); onCommented(); }
  };
  return <div className="flex flex-col gap-3">
    {events.length === 0 ? <p className="ui-description text-text-muted">{t("pulls.noActivity")}</p> : events.map((event) => <div key={event.key}>{event.node}</div>)}
    <div className="mt-2 flex flex-col gap-2 rounded-[10px] border border-border-subtle p-2">
      <textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={65_536} rows={3} placeholder={t("pulls.commentPlaceholder")} aria-label={t("pulls.commentPlaceholder")} className="w-full resize-y bg-transparent px-1 ui-body text-text-primary outline-none placeholder:text-text-muted" />
      <div className="flex justify-end"><InteractiveButton variant="secondary" glow={false} loading={busy} disabled={!text.trim()} onClick={() => void send()}><MessageSquare size={14} />{t("pulls.comment")}</InteractiveButton></div>
    </div>
  </div>;
}

function Entry({ author, at, badge, body }: { author: string | null; at: string | null; badge?: string; body: string }) {
  const t = useTranslation();
  const time = at ? relativeTime(at) : "";
  return <div className="rounded-[10px] border border-border-subtle px-3 py-2">
    <p className="flex items-center gap-2 ui-caption text-text-muted"><span className="text-text-secondary">{author ?? t("pulls.someone")}</span>{badge ? <span>{badge}</span> : null}<span className="ml-auto">{time === "now" ? t("Now") : time}</span></p>
    {body.trim() ? <p className="mt-1 whitespace-pre-wrap ui-body text-text-secondary [overflow-wrap:anywhere] selectable">{body}</p> : null}
  </div>;
}

function Code({ item }: { item: GithubItem }) {
  const t = useTranslation();
  const [files, setFiles] = useState<ReturnType<typeof splitDiff> | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void client.pullRequestAction({ type: "diff", repository: item.repository, number: item.number }).then((response) => {
      if (!live || response.type !== "diff") return;
      setFiles(splitDiff(response.text));
      setTruncated(response.truncated);
    }, (reason: unknown) => { if (live) setError(formatUnknownError(reason)); });
    return () => { live = false; };
  }, [item.repository, item.number]);
  if (error) return <p role="alert" className="ui-description text-danger">{t(error)}</p>;
  if (!files) return <p role="status" className="ui-description text-text-muted">{t("common.loading")}</p>;
  const changes: FileChange[] = files.map((file) => ({ path: file.path, kind: "modified", additions: file.additions, deletions: file.deletions }));
  const current = changes.find((change) => change.path === selected) ?? changes[0] ?? null;
  return <div className="flex min-h-[420px] flex-col">
    {truncated ? <p className="mb-2 ui-caption text-text-muted">{t("pulls.diffTruncated")}</p> : null}
    <DiffViewer changes={changes} selected={current} diff={current ? files.find((file) => file.path === current.path)?.diff ?? null : null} onSelect={(change) => setSelected(change.path)} emptyDiffMessage={t("pulls.noDiff")} />
  </div>;
}
