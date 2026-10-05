import { useId, useMemo, useState } from "react";
import { FileDiff, MessageSquarePlus, X } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import type { FileChange } from "@/client/types";
import { reviewDiffLines, type DiffComment } from "@/lib/diff-comment";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { IconButton } from "@/primitives/IconButton";
import { cn } from "@/lib/cn";
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { CodeBlock } from "@/components/arc/code-block/code-block";

export function DiffViewer({ changes, selected, diff, onSelect, emptyDiffMessage, onComment, hideFileList = false }: { changes: FileChange[]; selected: FileChange | null; diff: string | null; onSelect: (change: FileChange) => void; emptyDiffMessage?: string; hideFileList?: boolean; onComment?: (selection: DiffComment) => boolean }) {
  const t = useTranslation();
  const commentId = useId();
  const lines = useMemo(() => reviewDiffLines(diff ?? ""), [diff]);
  const [range, setRange] = useState<{ path: string; diff: string; anchor: number; from: number; to: number } | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState(false);
  const activeRange = range?.path === selected?.path && range?.diff === diff ? range : null;
  const choose = (from: number, to = from, extend = false) => {
    if (!selected || diff === null || !onComment) return;
    const anchor = extend && activeRange ? activeRange.anchor : from;
    if (!activeRange) setComment("");
    setRange({ path: selected.path, diff, anchor, from: Math.min(anchor, to), to: Math.max(anchor, to) });
    setError(false);
  };
  if (!changes.length) return <EmptyState icon={<FileDiff size={22} />} title={t("No changes")} description={t("Nenhuma alteração detectada neste worktree.")} className="p-4" />;
  return <div className="flex h-full min-h-0 flex-col">
    {!hideFileList && <div className="scroll-thin max-h-[35%] shrink-0 overflow-auto border-b border-border-subtle" aria-label={t("Changes")}>
      {changes.map((change) => <button key={change.path} type="button" aria-pressed={selected?.path === change.path} onClick={() => onSelect(change)} className={cn("flex w-full items-center justify-between gap-2 px-3 py-2 text-left ui-control hover:bg-background-3", selected?.path === change.path ? "bg-background-3 text-text-primary" : "text-text-secondary")}>
        <span className="min-w-0 truncate" title={change.path}>{change.path}<span className="ml-2 ui-micro text-text-muted">{t(`change.${change.kind}`)}</span></span>
        <span className="shrink-0 font-mono ui-micro"><span className="text-success">+{change.additions}</span>{" "}<span className="text-danger">−{change.deletions}</span></span>
      </button>)}
    </div>}
    {!selected ? <EmptyState title={t("Review changes")} description={t("Select a file to view its diff.")} icon={<FileDiff size={22} />} className="p-4" /> : diff === null ? <p role="status" className="p-3 ui-control text-text-muted">{t("Loading diff…")}</p> : <>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3 py-2"><span className="min-w-0 truncate font-mono ui-caption" title={selected.path}>{selected.path}</span><CopyButton value={diff} label={t("Copy diff")} /></div>
      {onComment && diff.length ? <p className="shrink-0 px-3 py-1 ui-micro text-text-muted">{t("review.commentHint")}</p> : null}
      <div className="selectable scroll-thin min-h-0 flex-1 overflow-auto" tabIndex={0} role="region" aria-label={t("diff.label", { path: selected.path })}
        onPointerUp={event => {
          if (!onComment || (event.target as Element).closest("button")) return;
          const selection = window.getSelection();
          if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
          const picked = selection.getRangeAt(0);
          const row = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-diff-index]");
          const start = row(picked.startContainer), end = row(picked.endContainer);
          if (start && end && event.currentTarget.contains(start) && event.currentTarget.contains(end)) choose(Number(start.dataset.diffIndex), Number(end.dataset.diffIndex));
        }}>
        {diff.startsWith("+++ untracked\n") && !onComment ? <div className="p-2"><CodeBlock code={diff.slice("+++ untracked\n".length)} filename={selected.path} language={selected.path.split(".").at(-1) ?? "text"} animateChanges={false} /></div> : diff.length === 0 ? <p className="p-3 ui-control text-text-muted">{emptyDiffMessage ?? t("No textual diff available.")}</p> : <div className="diff-code min-w-max py-2 leading-5">
          {lines.map((line, index) => <div key={index} data-diff-index={index} className={cn("flex pr-3", activeRange && index >= activeRange.from && index <= activeRange.to ? "bg-accent/20" : line.kind === "addition" ? "bg-success/10" : line.kind === "deletion" ? "bg-danger/10" : line.kind === "header" ? "bg-background-2" : "", line.kind === "addition" ? "text-success" : line.kind === "deletion" ? "text-danger" : line.kind === "header" ? "text-text-muted" : "text-text-secondary")}>
            {onComment && line.kind !== "header" ? <button type="button" aria-label={t("review.selectLine", { old: line.oldLine ?? "—", new: line.newLine ?? "—" })} aria-pressed={!!activeRange && index >= activeRange.from && index <= activeRange.to} onClick={event => choose(index, index, event.shiftKey)} className="mr-2 flex w-[72px] shrink-0 select-none border-r border-border-subtle text-text-muted hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-accent"><span className="w-9 pr-1 text-right">{line.oldLine ?? ""}</span><span className="w-9 pr-2 text-right">{line.newLine ?? ""}</span></button> : <><span aria-hidden="true" className="w-9 shrink-0 select-none pr-1 text-right text-text-muted">{line.oldLine ?? ""}</span><span aria-hidden="true" className="mr-2 w-9 shrink-0 select-none border-r border-border-subtle pr-2 text-right text-text-muted">{line.newLine ?? ""}</span></>}<span className="whitespace-pre">{line.content}</span>
          </div>)}
        </div>}
      </div>
      {activeRange && onComment ? <form className="shrink-0 space-y-2 border-t border-border-subtle p-3" onSubmit={event => {
        event.preventDefault();
        if (!onComment({ path: activeRange.path, diff: activeRange.diff, from: activeRange.from, to: activeRange.to, comment })) { setError(true); return; }
        setRange(null); setComment(""); setError(false);
      }}>
        <div className="flex items-center justify-between"><label htmlFor={commentId} className="ui-caption text-text-primary">{t("review.comment")}</label><IconButton label={t("review.clearSelection")} onClick={() => { setRange(null); setComment(""); setError(false); }}><X size={14} /></IconButton></div>
        <p className="ui-micro text-text-muted">{t("review.selectedLines", { count: activeRange.to - activeRange.from + 1 })}</p>
        <textarea id={commentId} value={comment} maxLength={16384} rows={2} onChange={event => { setComment(event.target.value); setError(false); }} aria-invalid={error || undefined} aria-describedby={error ? `${commentId}-error` : undefined} className="w-full resize-none rounded-[7px] border border-border-subtle bg-background-2 p-2 ui-control text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent" placeholder={t("review.commentPlaceholder")} />
        {error ? <p id={`${commentId}-error`} role="alert" className="ui-caption text-danger">{t("review.commentFailed")}</p> : null}
        <InteractiveButton type="submit" variant="secondary" disabled={!comment.trim()}><MessageSquarePlus size={14} aria-hidden="true" />{t("Add to chat")}</InteractiveButton>
      </form> : null}
    </>}
  </div>;
}
