import { useId, useState } from "react";
import { Check, ChevronDown, ChevronUp, FileDiff } from "@/components/icons/phosphor";
import type { TurnReview } from "@/client/types";
import { fileIconFor } from "@/lib/file-icons";
import { useTranslation } from "@/i18n/use-translation";
import { useAppStore } from "@/store/app-store";
import { UndoTurnButton } from "@/components/UndoTurnButton";

export function ChangeTally({ additions, deletions }: { additions: number; deletions: number }) {
  return <span className="inline-flex shrink-0 gap-2 font-mono ui-micro tabular-nums"><span className="text-success">+{additions}</span><span className="text-danger">−{deletions}</span></span>;
}

/** Approved compact list; changes are already applied, Keep acknowledges native history. */
export function TurnChangeSummary({ sessionId, messageId, review }: { sessionId: string; messageId: string; review: TurnReview }) {
  const t = useTranslation();
  const listId = useId();
  const [expanded, setExpanded] = useState(true);
  const [all, setAll] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const openReview = useAppStore((s) => s.openTurnReview);
  const keep = useAppStore((s) => s.keepTurnChanges);
  if (!review.files.length && !review.partial) return null;
  const total = review.files.reduce((sum, f) => ({ additions: sum.additions + f.additions, deletions: sum.deletions + f.deletions }), { additions: 0, deletions: 0 });
  const keepChanges = async () => {
    if (pending || review.keptAt) return;
    setPending(true); setError(false);
    try { await keep(sessionId, messageId); } catch { setError(true); } finally { setPending(false); }
  };
  return <section aria-label={t("review.title")} className="my-4 overflow-hidden rounded-xl border border-[color-mix(in_oklab,var(--text-primary)_12%,transparent)] bg-[color-mix(in_oklab,var(--text-primary)_3%,transparent)]">
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 px-3 py-3">
      <FileDiff size={17} aria-hidden="true" className="shrink-0 text-text-muted" />
      <button type="button" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)} className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left">
        <span className="ui-control font-medium text-text-primary">{t(review.partial ? "review.partialFiles" : "review.files", { count: review.files.length })}</span>
        {review.files.some((file) => !file.binary) ? <ChangeTally {...total} /> : null}
      </button>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {review.files.length && !review.files.every((file) => file.undoneAt) ? <button type="button" disabled={pending || !!review.keptAt} title={t("review.keepHelp")} onClick={() => void keepChanges()} className="inline-flex items-center gap-1 rounded-[7px] px-2 py-1.5 ui-caption text-text-secondary hover:bg-background-3 disabled:cursor-default disabled:opacity-60">
          {review.keptAt ? <Check size={12} aria-hidden="true" /> : null}{t(review.keptAt ? "review.kept" : pending ? "review.keeping" : "review.keep")}
        </button> : null}
        {review.files.length && !review.expired ? <UndoTurnButton sessionId={sessionId} messageId={messageId} review={review} className="inline-flex items-center gap-1 rounded-[7px] px-2 py-1.5 ui-caption text-text-secondary hover:bg-background-3 disabled:cursor-default disabled:opacity-60" /> : null}
        <button type="button" onClick={() => openReview(sessionId, messageId)} className="rounded-[7px] border border-border-default px-2.5 py-1.5 ui-caption text-text-primary hover:bg-background-3">{t("review.open")}</button>
        <button type="button" aria-label={t(expanded ? "review.collapse" : "review.expand")} aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)} className="rounded-[7px] p-1 text-text-muted hover:bg-background-3">{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
      </div>
    </div>
    <div id={listId} hidden={!expanded} className="border-t border-border-subtle">
      {(all ? review.files : review.files.slice(0, 3)).map((file) => {
        const { Icon, color } = fileIconFor(file.path.split("/").at(-1) ?? file.path);
        return <button type="button" key={file.path} aria-label={t("review.file", { path: file.path })} onClick={() => openReview(sessionId, messageId, file.path)} className="flex w-full items-center gap-2.5 border-b border-border-subtle px-3 py-2.5 text-left hover:bg-background-3">
          <Icon size={14} color={color} aria-hidden="true" className="shrink-0" />
          <span title={file.path} className="min-w-0 flex-1 truncate font-mono ui-caption text-text-secondary">{file.path}</span>
          <span className="sr-only">{t(`change.${file.kind}`)}</span>
          {file.undoneAt ? <span className="ui-micro text-text-muted">{t("undo.done")}</span> : file.binary ? <span className="ui-micro text-text-muted">{t("review.binary")}</span> : <ChangeTally additions={file.additions} deletions={file.deletions} />}
        </button>;
      })}
      {review.files.length > 3 ? <button type="button" onClick={() => setAll(!all)} className="w-full px-3 py-2 text-left ui-caption text-text-muted hover:bg-background-3">{t(all ? "review.less" : "review.more", { count: review.files.length - 3 })}</button> : null}
    </div>
    {review.partial ? <p className="px-3 pb-2 ui-micro text-text-muted">{t("review.partial")}</p> : null}
    {error ? <p role="alert" className="px-3 pb-2 ui-caption text-danger">{t("review.failed")}</p> : null}
  </section>;
}
