import { useEffect, useState } from "react";
import { CheckCircle2, ChevronRight, CircleDashed, CircleMinus, Clock3, ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed, LoaderCircle, Pause, RefreshCw, XCircle, Zap } from "@/components/icons/phosphor";
import { client } from "@/client";
import type { PullRequest, PullRequestCheckStatus, Session } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { checkSummary, lookupLabels, pullRequestState } from "@/lib/pull-requests";
import { formatUnknownError } from "@/lib/format-error";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { useAppStore } from "@/store/app-store";
import "@/styles/pull-request.css";

export function EnvironmentPullRequestSection({ session }: { session: Session }) {
  const t = useTranslation();
  const state = useAppStore(store => store.pullRequestsBySession[session.id]);
  const branch = useAppStore(store => store.selectedSessionId === session.id ? store.gitStatus?.identity.branch : undefined);
  const refresh = useAppStore(store => store.refreshPullRequest);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => { void refresh(session.id); }, [session.id, session.worktree.path, branch, refresh]);
  const current = state?.workspacePath === session.worktree.path ? state : undefined;
  const loading = !current || current.loading;
  const snapshot = current?.snapshot;
  const pr = snapshot?.pullRequest;
  const open = async (url: string) => {
    setActionError(null);
    try { await client.openExternalUrl(url); } catch (error) { setActionError(formatUnknownError(error)); }
  };
  const StateIcon = pr?.state === "merged" ? GitMerge : pr?.state === "closed" ? GitPullRequestClosed : GitPullRequest;
  return <section className="environment-pr-section" aria-busy={loading}>
    <div className="environment-pr-heading">
      <p className="ui-caption text-text-muted">{t("Pull request")}</p>
      <button type="button" className="environment-pr-refresh" aria-label={t("Refresh pull request")} disabled={loading} onClick={() => void refresh(session.id, true)}><RefreshCw size={12} aria-hidden="true" /></button>
    </div>
    {loading ? <p className="environment-pr-message ui-description" role="status">{t("Loading pull request…")}</p> : current.error ?
      <p className="environment-pr-message ui-description text-danger" role="alert">{t(current.error)}</p> : pr ? <Popover>
        <PopoverTrigger asChild><button type="button" className="environment-pr-row ui-control" aria-label={t("Pull request #{number}: {title}", { number: pr.number, title: pr.title })}>
          <StateIcon size={14} aria-hidden="true" className={pr.state === "open" && !pr.draft ? "text-success" : "text-text-muted"} />
          <span className="min-w-0 flex-1 truncate text-left">#{pr.number} {pr.title}</span>
          <CheckIcon status={checkSummary(pr).status} /><ChevronRight size={12} aria-hidden="true" className="text-text-muted" />
        </button></PopoverTrigger>
        <p className="environment-pr-caption ui-caption">{t(pullRequestState(pr))} · {t(checkSummary(pr).label)}</p>
        {pr.state === "open" ? <CiFixRow sessionId={session.id} /> : null}
        <PopoverContent side="left" align="start" aria-label={t("Pull request details")} className="environment-pr-popover">
          <PullRequestDetails pr={pr} checkedAt={snapshot.checkedAt} onOpen={url => void open(url)} />
          {actionError && <p role="alert" className="ui-caption text-danger mt-2">{t(actionError)}</p>}
        </PopoverContent>
      </Popover> : <p className="environment-pr-message ui-description">{t(snapshot && snapshot.status !== "ready" ? lookupLabels[snapshot.status] : lookupLabels.unavailable)}</p>}
  </section>;
}

/** CI auto-fix status for this session's open PR, with a per-PR off switch (ADR-064). */
export function CiFixRow({ sessionId }: { sessionId: string }) {
  const t = useTranslation();
  const enabled = useAppStore(store => store.settings.ciAutoFix);
  const fix = useAppStore(store => store.ciAutoFix.find(item => item.sessionId === sessionId));
  const action = useAppStore(store => store.ciAutofixAction);
  if (!enabled) return null;
  const status = fix?.status ?? "watching";
  const toggle = (on: boolean) => void action({ type: "setEnabled", sessionId, enabled: on });
  const tone = status === "fixing" ? "fixing" : status === "paused" ? "paused" : status === "off" ? "off" : fix?.fixedIn ? "green" : "watching";
  const Icon = tone === "fixing" ? LoaderCircle : tone === "paused" ? Pause : tone === "green" ? CheckCircle2 : Zap;
  const label = tone === "fixing" ? t("ciFix.fixing", { attempt: fix?.attempts ?? 1 })
    : tone === "paused" ? t("ciFix.paused")
    : tone === "off" ? t("ciFix.off")
    : tone === "green" ? t("ciFix.green", { count: fix?.fixedIn ?? 1 })
    : t("ciFix.watching");
  return <div className="environment-ci-fix" data-tone={tone}>
    <div className="environment-ci-fix-line">
      <Icon size={12} aria-hidden="true" className={tone === "fixing" ? "animate-spin" : undefined} />
      <span className="min-w-0 flex-1 truncate ui-caption" role="status">{label}</span>
      {tone === "paused" || tone === "off"
        ? <button type="button" className="environment-ci-fix-action ui-caption" onClick={() => toggle(true)}>{t("ciFix.turnOn")}</button>
        : tone !== "fixing" ? <button type="button" className="environment-ci-fix-action ui-caption" onClick={() => toggle(false)}>{t("ciFix.turnOff")}</button> : null}
    </div>
    {tone === "paused" && fix?.reason ? <p className="ui-caption text-text-muted">{t(`ciFix.reason.${fix.reason}`)}</p> : null}
  </div>;
}

export function PullRequestDetails({ pr, checkedAt, onOpen }: { pr: PullRequest; checkedAt: string; onOpen: (url: string) => void }) {
  const t = useTranslation();
  const summary = checkSummary(pr);
  const stateNames: Record<PullRequestCheckStatus, string> = { passed: "Passed", failed: "Failed", pending: "In progress", skipped: "Skipped", unknown: "Unavailable" };
  return <>
    <p className="ui-control font-medium text-text-primary break-words">#{pr.number} {pr.title}</p>
    <p className="ui-caption text-text-muted mt-1 break-words">{t(pullRequestState(pr))} · {pr.headBranch} → {pr.baseBranch}</p>
    <div className="environment-pr-actions">
      <InteractiveButton variant="secondary" glow={false} onClick={() => onOpen(pr.url)}><ExternalLink size={12} aria-hidden="true" />{t("Open PR")}</InteractiveButton>
      <InteractiveButton variant="ghost" glow={false} onClick={() => onOpen(`${pr.url}/checks`)}>{t("View checks")}</InteractiveButton>
    </div>
    <div className="environment-pr-check-heading ui-description"><CheckIcon status={summary.status} /><span>{t(summary.label)}</span></div>
    <p className="ui-caption text-text-muted mt-1">{t("Checks for commit {sha}", { sha: pr.headSha.slice(0, 7) })}</p>
    {pr.localCommitDiffers && <p className="ui-caption text-text-muted mt-1">{t("The local commit differs from the PR commit.")}</p>}
    {(!pr.checksComplete || pr.checksTruncated) && <p className="ui-caption text-text-muted mt-1">{t(pr.checksTruncated ? "Showing a bounded preview. Open GitHub to see all checks." : "Some checks could not be loaded. Refresh or open GitHub.")}</p>}
    {!!pr.checks.length && <ul className="environment-pr-checks scroll-thin">{pr.checks.map(check => <li key={check.id}>
      {check.url ? <button type="button" className="environment-pr-check ui-description" onClick={() => onOpen(check.url!)} aria-label={t("Open check {name}: {status}", { name: check.name, status: t(stateNames[check.status]) })}>
        <CheckIcon status={check.status} /><span className="min-w-0 flex-1 break-words text-left">{check.name || t("Unnamed check")}</span><span className="ui-caption text-text-muted shrink-0">{t(stateNames[check.status])}</span>
      </button> : <div className="environment-pr-check ui-description"><CheckIcon status={check.status} /><span className="min-w-0 flex-1 break-words">{check.name || t("Unnamed check")}</span><span className="ui-caption text-text-muted shrink-0">{t(stateNames[check.status])}</span></div>}
    </li>)}</ul>}
    <p className="ui-caption text-text-muted mt-2">{t("Updated at {time}", { time: new Date(checkedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) })}</p>
  </>;
}
function CheckIcon({ status }: { status: PullRequestCheckStatus | "none" }) {
  const Icon = status === "passed" ? CheckCircle2 : status === "failed" ? XCircle : status === "pending" ? Clock3 : status === "unknown" ? CircleDashed : CircleMinus;
  return <Icon size={13} aria-hidden="true" className={`shrink-0 ${status === "passed" ? "text-success" : status === "failed" ? "text-danger" : "text-text-muted"}`} />;
}
