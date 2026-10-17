import { useCallback, useEffect, useState } from "react";
import { Check, ChevronRight, CornerUpLeft, FileCode2, RotateCcw } from "@/components/icons/phosphor";
import { client } from "@/client";
import type { GithubReviewThread } from "@/client/types";
import { GithubMarkdown } from "@/components/pull-requests/GithubMarkdown";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";
import { formatUnknownError } from "@/lib/format-error";
import { relativeTime } from "@/lib/session-board";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { useAppStore } from "@/store/app-store";
import "@/styles/pull-checks.css";

export type ThreadsState = { threads: GithubReviewThread[]; truncated: boolean } | { error: string } | null;

/** A pull request's inline review conversations, read when the Timeline opens (no polling). */
export function useReviewThreads(repository: string, number: number, enabled: boolean) {
  const key = `${repository}#${number}`;
  const [state, setState] = useState<{ key: string; value: ThreadsState } | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await client.pullRequestAction({ type: "reviewThreads", repository, number });
      if (response.type === "threads") setState({ key, value: { threads: response.threads, truncated: response.truncated } });
    } catch (reason) { setState({ key, value: { error: formatUnknownError(reason) } }); }
  }, [key, repository, number]);
  const loaded = state?.key === key;
  useEffect(() => { if (enabled && !loaded) void load(); }, [enabled, loaded, load]);
  return { threads: loaded ? state.value : null, reload: load };
}

/** One inline review conversation: file and line, the end of its diff hunk, comments and a Reply box. */
export function ReviewThreadEntry({ thread, repository, number, onChanged }: { thread: GithubReviewThread; repository: string; number: number; onChanged: () => void }) {
  const t = useTranslation();
  const [open, setOpen] = useState(!thread.isResolved && !thread.isOutdated);
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"reply" | "resolve" | null>(null);
  const line = thread.line ?? thread.originalLine;
  const where = line ? t("pulls.thread.on", { path: thread.path, line: thread.startLine && thread.startLine !== line ? `${thread.startLine}–${line}` : line }) : thread.path;
  const first = thread.comments[0];
  const time = first ? relativeTime(first.createdAt) : "";

  const reply = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy("reply");
    // The explicit Reply click is the confirmation for this one change, like Comment.
    const response = await useAppStore.getState().pullRequestAction({ type: "replyThread", repository, number, threadId: thread.id, body, confirm: true });
    setBusy(null);
    if (response) { setText(""); setReplying(false); onChanged(); }
  };
  const resolve = async (resolved: boolean) => {
    if (busy) return;
    setBusy("resolve");
    const response = await useAppStore.getState().pullRequestAction({ type: "resolveThread", repository, number, threadId: thread.id, resolved, confirm: true });
    setBusy(null);
    if (response) onChanged();
  };

  return <div className={cn("pull-thread", thread.isResolved && "pull-thread-resolved")}>
    <div className="pull-thread-head ui-caption">
      <button type="button" className="pull-thread-toggle" aria-expanded={open} aria-label={t(open ? "pulls.thread.hide" : "pulls.thread.show")} onClick={() => setOpen(!open)}>
        <ChevronRight size={12} className="pull-check-caret" aria-hidden="true" />
      </button>
      <FileCode2 size={13} className="shrink-0 text-text-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate font-mono text-text-secondary" title={where}>{where}</span>
      {thread.isOutdated ? <span className="pull-thread-badge">{t("pulls.thread.outdated")}</span> : null}
      {thread.isResolved ? <span className="pull-thread-badge" data-tone="resolved">{t("pulls.thread.resolved")}</span> : null}
      {!open && first ? <span className="shrink-0 text-text-muted">{first.author ?? t("pulls.someone")} · {time === "now" ? t("Now") : time}</span> : null}
    </div>
    {open ? <>
      {thread.diffHunk ? <pre className="pull-thread-hunk scroll-thin" aria-hidden="true">{thread.diffHunk.split("\n").map((row, index) => <span key={index} className={cn("block", row.startsWith("+") && "pulls-add", row.startsWith("-") && "pulls-del", row.startsWith("@@") && "text-text-muted")}>{row || " "}</span>)}</pre> : null}
      <div className="flex flex-col">
        {thread.comments.map((comment, index) => {
          const at = relativeTime(comment.createdAt);
          return <div key={index} className="pull-thread-comment">
            <p className="flex items-center gap-2 ui-caption text-text-muted"><span className="text-text-secondary">{comment.author ?? t("pulls.someone")}</span><span className="ml-auto">{at === "now" ? t("Now") : at}</span></p>
            <GithubMarkdown text={comment.body} repository={repository} number={number} className="mt-1" />
          </div>;
        })}
        {thread.commentCount > thread.comments.length ? <p className="pull-thread-comment ui-caption text-text-muted">{t("pulls.thread.more", { count: thread.commentCount - thread.comments.length })}</p> : null}
      </div>
      {replying ? <div className="pull-thread-reply">
        <textarea autoFocus value={text} onChange={(event) => setText(event.target.value)} maxLength={65_536} rows={3} placeholder={t("pulls.thread.replyPlaceholder")} aria-label={t("pulls.thread.replyPlaceholder")} className="w-full resize-y bg-transparent px-1 ui-body text-text-primary outline-none placeholder:text-text-muted" />
        <div className="flex justify-end gap-1.5">
          <InteractiveButton variant="ghost" glow={false} onClick={() => { setReplying(false); setText(""); }}>{t("common.cancel")}</InteractiveButton>
          <InteractiveButton variant="secondary" glow={false} loading={busy === "reply"} disabled={!text.trim()} onClick={() => void reply()}><CornerUpLeft size={14} />{t("pulls.thread.reply")}</InteractiveButton>
        </div>
      </div> : (thread.viewerCanReply || thread.viewerCanResolve || thread.viewerCanUnresolve) ? <div className="pull-thread-actions">
        {thread.viewerCanReply ? <InteractiveButton variant="toolbar" onClick={() => setReplying(true)}><CornerUpLeft size={13} />{t("pulls.thread.reply")}</InteractiveButton> : null}
        {thread.isResolved && thread.viewerCanUnresolve ? <InteractiveButton variant="toolbar" loading={busy === "resolve"} onClick={() => void resolve(false)}><RotateCcw size={13} />{t("pulls.thread.unresolve")}</InteractiveButton> : null}
        {!thread.isResolved && thread.viewerCanResolve ? <InteractiveButton variant="toolbar" loading={busy === "resolve"} onClick={() => void resolve(true)}><Check size={13} />{t("pulls.thread.resolve")}</InteractiveButton> : null}
      </div> : null}
    </> : null}
  </div>;
}
