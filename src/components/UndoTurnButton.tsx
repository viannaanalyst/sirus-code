import { useState } from "react";
import type { TurnReview, UndoTurnOutcome } from "@/client/types";
import { client } from "@/client";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { useAppStore } from "@/store/app-store";

/** Files of a review that still have a retained text diff to reverse. */
export function undoableFiles(review: TurnReview, path?: string) {
  return review.files.filter((file) => !file.undoneAt && !file.binary && file.diff && (!path || file.path === path));
}

/** Undo a settled turn's changes (all files, or one) after a confirmation (ADR-061). */
export function UndoTurnButton({ sessionId, messageId, review, path, className }: { sessionId: string; messageId: string; review: TurnReview; path?: string; className?: string }) {
  const t = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<UndoTurnOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useAppStore((state) => ["starting", "running", "waiting"].includes(state.sessions.find((session) => session.id === sessionId)?.status ?? ""));
  const files = undoableFiles(review, path);
  const undone = path ? review.files.some((file) => file.path === path && file.undoneAt) : review.files.length > 0 && review.files.every((file) => file.undoneAt);
  if (undone) return <span className="px-2 py-1.5 ui-caption text-text-muted">{t("undo.done")}</span>;
  if (!files.length) return null;
  const undo = async () => {
    setError(null);
    try {
      const result = await client.undoTurnChanges(sessionId, messageId, path ? [path] : undefined);
      setOutcome(result);
      return true;
    } catch (reason) {
      setError(formatUnknownError(reason));
      return false;
    }
  };
  return <>
    <button type="button" disabled={running} title={t(running ? "undo.wait" : path ? "undo.fileHelp" : "undo.help")} onClick={() => { setOutcome(null); setConfirming(true); }} className={className}>
      {t(path ? "undo.file" : "undo.action")}
    </button>
    {outcome?.refused.length ? <span role="status" className="ui-caption text-text-muted">{t("undo.refused", { count: outcome.refused.length })}</span> : null}
    <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={t(path ? "undo.fileTitle" : "undo.title")} description={t("undo.description")} confirmLabel={t(path ? "undo.file" : "undo.action")} onConfirm={undo}>
      {path ? <p className="mb-4 truncate font-mono ui-caption text-text-secondary">{path}</p> : <p className="mb-4 ui-caption text-text-secondary">{t("undo.count", { count: files.length })}</p>}
      {error ? <p role="alert" className="mb-4 ui-caption text-danger">{t(error)}</p> : null}
    </ConfirmDialog>
  </>;
}
