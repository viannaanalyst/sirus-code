import { useMemo, useState } from "react";
import { DiffViewer, type DiffReviewFile } from "@/components/DiffViewer";
import { useTranslation } from "@/i18n/use-translation";
import { useAppStore } from "@/store/app-store";
import { useRetainedTranscripts } from "@/lib/use-retained-transcripts";
import { UndoTurnButton } from "@/components/UndoTurnButton";
import { diffViewState } from "@/lib/diff-view-state";

/** Uses retained turn data, never mutable git_diff/current worktree status. */
export function TurnReviewPane({ sessionId, messageId, path }: { sessionId: string; messageId: string; path?: string }) {
  const t = useTranslation();
  // A review tab can outlive the session's selection; its transcript stays loaded.
  useRetainedTranscripts([sessionId]);
  const stored = useAppStore((s) => s.sessions.find((session) => session.id === sessionId)?.messages.find((m) => m.id === messageId && m.sessionId === sessionId)?.activity?.review);
  // Files committed through Sirus have left the review (ADR-108).
  const review = useMemo(() => stored && stored.files.some((file) => file.committedAt) ? { ...stored, files: stored.files.filter((file) => !file.committedAt) } : stored, [stored]);
  // The tab keeps its place (ADR-145): the file in view comes back with it, unless the tab was reopened on another file.
  const viewKey = `review:${sessionId}:${messageId}`;
  const [selectedPath, setSelectedPath] = useState(() => { const saved = diffViewState(viewKey); return saved && (saved.origin ?? null) === (path ?? null) ? saved.selected ?? path : path; });
  const documents = useMemo<DiffReviewFile[]>(() => (review?.files ?? []).map((file) => ({
    path: file.path, diff: review?.expired || file.binary ? null : file.diff,
    message: t(review?.expired ? "review.expired" : file.binary ? "review.binaryDiff" : file.diff === null ? "review.omittedDiff" : "review.noTextDiff"),
  })), [review, t]);
  if (!review) return <p className="p-4 ui-control text-text-muted">{t("review.missing")}</p>;
  const selected = review.files.find((file) => file.path === selectedPath) ?? review.files[0] ?? null;
  const unavailable = review.expired ? "review.expired" : selected?.binary ? "review.binaryDiff" : selected?.diff === null ? "review.omittedDiff" : "review.noTextDiff";
  return <div className="flex h-full min-h-0 flex-col">
    <div className="shrink-0 space-y-1 border-b border-border-subtle px-3 py-2 ui-micro text-text-muted">
      <p>{t("review.historical")} · {t("review.readOnly")}</p>
      {review.sharedWorkspace ? <p>{t("review.shared")}</p> : null}
      {review.partial ? <p>{t("review.partial")}</p> : null}
      {review.expired ? <p>{t("review.expired")}</p> : null}
      {selected && !review.expired ? <div className="flex items-center gap-2 pt-1"><UndoTurnButton key={selected.path} sessionId={sessionId} messageId={messageId} review={review} path={selected.path} className="inline-flex items-center gap-1 rounded-[7px] border border-border-default px-2 py-1 ui-caption text-text-secondary hover:bg-background-3 disabled:opacity-60" /></div> : null}
    </div>
    <div className="min-h-0 flex-1">
      {review.files.length ? <DiffViewer changes={review.files} selected={selected} diff={null} files={documents} viewKey={viewKey} viewOrigin={path ?? null} onSelect={(file) => setSelectedPath(file.path)} emptyDiffMessage={t(unavailable)} onComment={!review.expired ? selection => {
        const state = useAppStore.getState();
        if (!state.addReviewComment(sessionId, messageId, selection)) return false;
        window.getSelection()?.removeAllRanges();
        requestAnimationFrame(() => {
          if (useAppStore.getState().selectedSessionId !== sessionId) return;
          const composer = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea[data-draft-owner]")).find(node => node.dataset.draftOwner === `session:${sessionId}`);
          if (composer) { composer.focus({ preventScroll: true }); composer.setSelectionRange(composer.value.length, composer.value.length); }
        });
        return true;
      } : undefined} /> : <p className="p-4 ui-control text-text-muted">{t("review.emptyPartial")}</p>}
    </div>
  </div>;
}
