import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronRight, ChevronsDownUp, ChevronsUpDown, FileDiff, Folder, FolderOpen } from "@/components/icons/phosphor";
import { buildDiffTree, diffTotals, type DiffTreeNode } from "@/lib/diff-tree";
import type { TurnReview } from "@/client/types";
import { fileIconFor } from "@/lib/file-icons";
import { useTranslation } from "@/i18n/use-translation";
import { useAppStore } from "@/store/app-store";
import { UndoTurnButton } from "@/components/UndoTurnButton";

export function ChangeTally({ additions, deletions }: { additions: number; deletions: number }) {
  return <span className="inline-flex shrink-0 gap-2 font-mono ui-micro tabular-nums"><span className="text-success">+{additions}</span><span className="text-danger">−{deletions}</span></span>;
}

/** Folder-tree expansion per turn, kept while the app runs (T3 keeps it per thread too). */
const expandedByTurn = new Map<string, { all: boolean; overrides: Record<string, boolean> }>();

/**
 * A turn's changed files, after T3 Code: "N changed files +a −d" with Open diff, then the files
 * as a folder tree (folders start closed; "expand all" opens them). Changes are already applied;
 * Keep acknowledges native history and Undo reverts what still matches.
 */
export function TurnChangeSummary({ sessionId, messageId, review }: { sessionId: string; messageId: string; review: TurnReview }) {
  const t = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [folders, setFolders] = useState(() => expandedByTurn.get(messageId) ?? { all: false, overrides: {} });
  const openReview = useAppStore((s) => s.openTurnReview);
  const keep = useAppStore((s) => s.keepTurnChanges);
  const tree = useMemo(() => buildDiffTree(review.files), [review.files]);
  if (!review.files.length) return null;
  const total = diffTotals(review.files);
  const hasFolders = tree.some((node) => node.kind === "directory");
  const saveFolders = (next: typeof folders) => { expandedByTurn.set(messageId, next); setFolders(next); };
  const keepChanges = async () => {
    if (pending || review.keptAt) return;
    setPending(true); setError(false);
    try { await keep(sessionId, messageId); } catch { setError(true); } finally { setPending(false); }
  };
  const byPath = new Map(review.files.map((file) => [file.path, file]));
  const row = (node: DiffTreeNode, depth: number): ReactNode => {
    const indent = { paddingLeft: 8 + depth * 14 };
    if (node.kind === "directory") {
      const open = folders.overrides[node.path] ?? folders.all;
      return <div key={`d:${node.path}`}>
        <button type="button" aria-expanded={open} className="changed-files-row group" style={indent} onClick={() => saveFolders({ ...folders, overrides: { ...folders.overrides, [node.path]: !open } })}>
          <ChevronRight size={13} aria-hidden="true" className={open ? "changed-files-chevron changed-files-chevron-open" : "changed-files-chevron"} />
          {open ? <FolderOpen size={14} aria-hidden="true" className="shrink-0 text-text-muted" /> : <Folder size={14} aria-hidden="true" className="shrink-0 text-text-muted" />}
          <span className="changed-files-name text-text-muted">{node.name}</span>
          {node.stat.additions || node.stat.deletions ? <span className="ml-auto"><ChangeTally {...node.stat} /></span> : null}
        </button>
        {open ? node.children.map((child) => row(child, depth + 1)) : null}
      </div>;
    }
    const file = byPath.get(node.path);
    const { Icon, color } = fileIconFor(node.name);
    return <button type="button" key={`f:${node.path}`} aria-label={t("review.file", { path: node.path })} title={node.path} className="changed-files-row group" style={indent} onClick={() => openReview(sessionId, messageId, node.path)}>
      {hasFolders || depth > 0 ? <span aria-hidden="true" className="w-[13px] shrink-0" /> : null}
      <Icon size={14} color={color} aria-hidden="true" className="shrink-0" />
      <span className="changed-files-name text-text-secondary group-hover:text-text-primary">{node.name}</span>
      {file ? <span className="sr-only">{t(`change.${file.kind}`)}</span> : null}
      <span className="ml-auto shrink-0">{file?.undoneAt ? <span className="ui-micro text-text-muted">{t("undo.done")}</span> : file?.binary ? <span className="ui-micro text-text-muted">{t("review.binary")}</span> : node.stat ? <ChangeTally {...node.stat} /> : null}</span>
    </button>;
  };
  return <section aria-label={t("review.title")} className="changed-files">
    <div className="changed-files-header">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="ui-caption font-medium text-text-primary">{review.files.length === 1 ? t("review.files.one") : t("review.files", { count: review.files.length })}</span>
        {total.additions || total.deletions ? <ChangeTally {...total} /> : null}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {!review.files.every((file) => file.undoneAt) ? <button type="button" disabled={pending || !!review.keptAt} title={t("review.keepHelp")} onClick={() => void keepChanges()} className="changed-files-action">
          {review.keptAt ? <Check size={12} aria-hidden="true" /> : null}{t(review.keptAt ? "review.kept" : pending ? "review.keeping" : "review.keep")}
        </button> : null}
        {!review.expired ? <UndoTurnButton sessionId={sessionId} messageId={messageId} review={review} className="changed-files-action" /> : null}
        {hasFolders ? <button type="button" aria-label={t(folders.all ? "review.collapseFolders" : "review.expandFolders")} title={t(folders.all ? "review.collapseFolders" : "review.expandFolders")} onClick={() => saveFolders({ all: !folders.all, overrides: {} })} className="changed-files-action">
          {folders.all ? <ChevronsDownUp size={13} aria-hidden="true" /> : <ChevronsUpDown size={13} aria-hidden="true" />}
        </button> : null}
        <button type="button" onClick={() => openReview(sessionId, messageId, review.files[0]?.path)} className="changed-files-action"><FileDiff size={13} aria-hidden="true" />{t("review.openDiff")}</button>
      </div>
    </div>
    <div className="changed-files-tree">{tree.map((node) => row(node, 0))}</div>
    {review.partial ? <p className="px-3 pb-2 ui-micro text-text-muted">{t("review.partial")}</p> : null}
    {error ? <p role="alert" className="px-3 pb-2 ui-caption text-danger">{t("review.failed")}</p> : null}
  </section>;
}
