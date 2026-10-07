import { useEffect, useMemo, useState } from "react";
import type { BranchInfo } from "@/client/types";
import { client } from "@/client";
import { Check, ExternalLink, ChevronLeft, GitBranch, GitPullRequest, LoaderCircle, Plus, RefreshCw, Search } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { checkSummary, lookupLabels, pullRequestState } from "@/lib/pull-requests";
import { useAppStore } from "@/store/app-store";
import type { MobileNavigation } from "./MobileApp";
import { MobileDialog } from "./MobileDialog";

/**
 * Branch and pull request of a conversation on the phone (ADR-086). Only the project
 * checkout switches branches; an isolated worktree keeps its own, as on the Mac.
 */
export function MobileGit({ sessionId, navigation }: { sessionId: string; navigation: MobileNavigation }) {
  const t = useTranslation();
  const session = useAppStore((state) => state.sessions.find((item) => item.id === sessionId));
  const status = useAppStore((state) => state.selectedSessionId === sessionId ? state.gitStatus : null);
  const pr = useAppStore((state) => state.pullRequestsBySession[sessionId]);
  const [branches, setBranches] = useState<BranchInfo[] | null>(null);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<{ name: string; create: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const isolated = !!session?.worktree.isolated;
  const projectId = session?.projectId ?? "";
  const branch = status?.identity.branch ?? session?.worktree.branch ?? "";

  const load = () => { if (!isolated && projectId) void client.listBranches(projectId).then(setBranches, () => setBranches([])); };
  useEffect(() => {
    void useAppStore.getState().refreshGitStatus();
    void useAppStore.getState().refreshPullRequest(sessionId, true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per page
  }, [sessionId]);

  const shown = useMemo(() => (branches ?? []).filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase())), [branches, query]);
  const exact = shown.some((item) => item.name === query.trim());
  const apply = async () => {
    if (!target || busy) return;
    setBusy(true);
    try {
      await (target.create ? client.createBranch(projectId, target.name) : client.checkoutBranch(projectId, target.name));
      await useAppStore.getState().refreshGitStatus();
      void useAppStore.getState().refreshPullRequest(sessionId, true);
      setTarget(null);
      setQuery("");
      load();
    } catch (error) {
      useAppStore.setState({ error: formatUnknownError(error) });
    } finally {
      setBusy(false);
    }
  };
  const pull = pr?.snapshot?.pullRequest ?? null;
  const checks = pull ? checkSummary(pull) : null;

  return <div className="mobile-page">
    <header className="mobile-bar">
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.back")} onClick={navigation.back}><ChevronLeft size={18} aria-hidden="true" /></button>
      <div className="mobile-bar-title"><h1>{t("mobile.git")}</h1><p>{session?.title}</p></div>
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.refresh")} onClick={() => { void useAppStore.getState().refreshGitStatus(); void useAppStore.getState().refreshPullRequest(sessionId, true); load(); }}><RefreshCw size={16} aria-hidden="true" /></button>
    </header>
    <div className="mobile-scroll mobile-form">
      <section>
        <h2>{t("mobile.branch")}</h2>
        <div className="mobile-card">
          <div className="mobile-setting">
            <span className="mobile-git-branch"><GitBranch size={16} aria-hidden="true" /><span>{branch || "—"}</span></span>
            {status && (status.ahead || status.behind) ? <span className="mobile-option-help">↑{status.ahead} ↓{status.behind}</span> : null}
          </div>
        </div>
        {isolated ? <p className="mobile-help">{t("env.isolatedBranch")}</p> : null}
      </section>

      {!isolated ? <section>
        <h2>{t("mobile.switchBranch")}</h2>
        <label className="mobile-search mobile-search-inline">
          <Search size={15} aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search branches…")} aria-label={t("Search branches…")} autoCapitalize="off" autoCorrect="off" />
        </label>
        <div className="mobile-card mobile-options">
          {branches === null ? <p className="mobile-empty">{t("common.loading")}</p> : shown.slice(0, 40).map((item) => <button key={item.name} type="button" className="mobile-option" disabled={item.current || busy} onClick={() => setTarget({ name: item.name, create: false })}>
            <GitBranch size={16} aria-hidden="true" />
            <span><span className="mobile-option-title">{item.name}</span></span>
            {item.current ? <Check size={15} aria-label={t("current")} /> : null}
          </button>)}
          {query.trim() && !exact ? <button type="button" className="mobile-option" disabled={busy} onClick={() => setTarget({ name: query.trim(), create: true })}>
            <Plus size={16} aria-hidden="true" /><span><span className="mobile-option-title">{t("env.createNamed", { name: query.trim() })}</span></span>
          </button> : null}
        </div>
      </section> : null}

      <section>
        <h2>{t("mobile.pullRequest")}</h2>
        <div className="mobile-card">
          {pr?.loading && !pr.snapshot ? <p className="mobile-empty"><LoaderCircle size={15} className="animate-spin" aria-hidden="true" /></p>
            : pull ? <div className="mobile-pr">
              <div className="mobile-pr-head"><GitPullRequest size={17} aria-hidden="true" /><span className="mobile-option-title">#{pull.number} {pull.title}</span></div>
              <div className="mobile-pr-meta">
                <span className="mobile-badge" data-badge={pull.state === "merged" ? "working" : pull.state === "closed" ? "stopped" : undefined}>{t(pullRequestState(pull))}</span>
                {checks ? <span className="mobile-pr-checks" data-status={checks.status}>{t(checks.label)}</span> : null}
              </div>
              <p className="mobile-option-help">{pull.headBranch} → {pull.baseBranch}</p>
              <button type="button" className="mobile-pr-open" onClick={() => window.open(pull.url, "_blank", "noopener")}>{t("mobile.openOnGithub")}<ExternalLink size={14} aria-hidden="true" /></button>
            </div>
            : <p className="mobile-empty">{pr?.error ?? (pr?.snapshot && pr.snapshot.status !== "ready" ? t(lookupLabels[pr.snapshot.status]) : t("No pull request for this branch."))}</p>}
        </div>
      </section>
    </div>
    <MobileDialog open={target !== null} title={t(target?.create ? "mobile.createBranchTitle" : "mobile.switchBranchTitle")} onClose={() => { if (!busy) setTarget(null); }}>
      <p className="mobile-help mobile-dialog-text">{t(target?.create ? "mobile.createBranchHelp" : "mobile.switchBranchHelp", { name: target?.name ?? "" })}</p>
      <div className="mobile-dialog-actions">
        <button type="button" className="mobile-dialog-button" disabled={busy} onClick={() => setTarget(null)}>{t("common.cancel")}</button>
        <button type="button" className="mobile-dialog-button" data-tone="primary" disabled={busy} onClick={() => void apply()}>{t(target?.create ? "mobile.create" : "mobile.switch")}</button>
      </div>
    </MobileDialog>
  </div>;
}
