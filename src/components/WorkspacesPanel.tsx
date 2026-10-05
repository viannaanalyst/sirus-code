import { useCallback, useEffect, useRef, useState } from "react";
import { FolderGit2, GitBranch, RefreshCw } from "@/components/icons/phosphor";
import { client } from "@/client";
import type { GitWorktree } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { selectCurrentProject, selectListedSessions, useAppStore } from "@/store/app-store";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { Badge } from "@/components/arc/badge/badge";
import { InteractiveButton } from "@/primitives/InteractiveButton";

export function WorkspacesPanel() {
  const t = useTranslation();
  const project = useAppStore(selectCurrentProject);
  const gitByPath = useAppStore((state) => state.gitByPath);
  const sessions = useAppStore(selectListedSessions);
  const selectSession = useAppStore((state) => state.selectSession);
  const requestNewSession = useAppStore((state) => state.requestNewSession);
  const [result, setResult] = useState<{ projectId: string; entries: GitWorktree[]; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const workspaceKey = sessions.filter((session) => session.projectId === project?.id).map((session) => session.worktree.path).sort().join("\0");
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    if (!project) return;
    setBusy(true);
    try {
      const entries = await client.listWorktrees(project.id);
      if (request === sequence.current) setResult({ projectId: project.id, entries, error: null });
    } catch (error) {
      if (request === sequence.current) setResult({ projectId: project.id, entries: [], error: formatUnknownError(error) });
    } finally { if (request === sequence.current) setBusy(false); }
  }, [project]);
  const invalidatePending = useCallback(() => { ++sequence.current; }, []);
  useEffect(() => { void refresh(); return invalidatePending; }, [refresh, workspaceKey, invalidatePending]);
  const current = result?.projectId === project?.id ? result : null;
  if (!project) return <EmptyState title={t("Workspaces")} description={t("Select a project to inspect its workspaces.")} icon={<FolderGit2 size={22} />} />;
  return <div className="scroll-thin h-full overflow-y-auto p-3">
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="ui-section-title">{t("Workspaces")}</h2>
      <InteractiveButton variant="toolbar" loading={busy} onClick={() => void refresh()} aria-label={t("Refresh workspaces")}><RefreshCw size={12} /></InteractiveButton>
    </div>
    {current?.error ? <p role="alert" className="mb-3 ui-control text-danger">{t(current.error)}</p> : null}
    {busy && !current ? <p role="status" className="ui-control text-text-muted">{t("common.loading")}</p> : null}
    {current?.entries.map((tree) => {
      const linked = sessions.filter((session) => session.projectId === project.id && (session.worktree.isolated ? session.worktree.path : gitByPath[session.worktree.path]?.root ?? session.worktree.path) === tree.path);
      return <article key={tree.path} className="border-b border-border-subtle py-3 first:pt-0">
        <div className="flex items-center gap-2"><GitBranch size={13} /><span className="min-w-0 flex-1 truncate ui-control">{tree.branch ?? (tree.detached ? t("Detached HEAD") : tree.head ?? t("Bare repository"))}</span>
          {tree.locked !== null ? <Badge size="sm">{t("Locked")}</Badge> : null}
          {tree.prunable !== null ? <Badge size="sm" tone="warning">{t("Unavailable")}</Badge> : null}
        </div>
        <p className="selectable mt-1 break-all font-mono ui-micro text-text-muted">{tree.path}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1"><CopyButton value={tree.path} label={t("Copy path")} iconOnly variant="plain" />
          {linked.map((session) => <InteractiveButton key={session.id} variant="toolbar" onClick={() => void selectSession(session.id)}>{session.title}</InteractiveButton>)}
          {!linked.length ? <span className="ui-caption text-text-muted">{t("No linked session")}</span> : null}
        </div>
      </article>;
    })}
    {current && !current.error && !current.entries.length ? <EmptyState title={t("No worktrees")} description={t("Create a session to use an isolated workspace.")} /> : null}
    <InteractiveButton className="mt-4" onClick={requestNewSession}>{t("session.new")}</InteractiveButton>
  </div>;
}
