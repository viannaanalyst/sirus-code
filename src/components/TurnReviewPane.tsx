import { useState } from "react";
import { DiffViewer } from "@/components/DiffViewer";
import { useTranslation } from "@/i18n/use-translation";
import { useAppStore } from "@/store/app-store";

/** Uses retained turn data, never mutable git_diff/current worktree status. */
export function TurnReviewPane({ sessionId, messageId, path }: { sessionId: string; messageId: string; path?: string }) {
  const t = useTranslation();
  const review = useAppStore((s) => s.sessions.find((session) => session.id === sessionId)?.messages.find((m) => m.id === messageId && m.sessionId === sessionId)?.activity?.review);
  const [selectedPath, setSelectedPath] = useState(path);
  if (!review) return <p className="p-4 ui-control text-text-muted">{t("review.missing")}</p>;
  const selected = review.files.find((file) => file.path === selectedPath) ?? review.files[0] ?? null;
  const unavailable = review.expired ? "review.expired" : selected?.binary ? "review.binaryDiff" : selected?.diff === null ? "review.omittedDiff" : "review.noTextDiff";
  return <div className="flex h-full min-h-0 flex-col">
    <div className="shrink-0 space-y-1 border-b border-border-subtle px-3 py-2 ui-micro text-text-muted">
      <p>{t("review.historical")} · {t("review.readOnly")}</p>
      {review.sharedWorkspace ? <p>{t("review.shared")}</p> : null}
      {review.partial ? <p>{t("review.partial")}</p> : null}
      {review.expired ? <p>{t("review.expired")}</p> : null}
    </div>
    <div className="min-h-0 flex-1">
      {review.files.length ? <DiffViewer changes={review.files} selected={selected} diff={selected?.diff ?? ""} onSelect={(file) => setSelectedPath(file.path)} emptyDiffMessage={t(unavailable)} onComment={!review.expired && selected?.diff && !selected.binary ? selection => {
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
