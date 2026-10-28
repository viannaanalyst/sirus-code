import { useState } from "react";
import type { TurnReview, UndoBlock, UndoTurnOutcome } from "@/client/types";
import { client } from "@/client";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { undoBlockSession, undoBlockText } from "@/lib/undo-block";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { useAppStore } from "@/store/app-store";

/** Files of a review that still have a retained text diff to reverse (natively; a transcript may omit its text, ADR-164). */
export function undoableFiles(review: TurnReview, path?: string) {
  return review.files.filter((file) => !file.undoneAt && !file.binary && (file.diff || file.diffOmitted) && (!path || file.path === path));
}

/** Undo a settled turn's changes (all files, or one) after a confirmation (ADR-061). */
export function UndoTurnButton({ sessionId, messageId, review, path, className }: { sessionId: string; messageId: string; review: TurnReview; path?: string; className?: string }) {
  const t = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<UndoTurnOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [block, setBlock] = useState<UndoBlock | null>(null);
  const selectSession = useAppStore((state) => state.selectSession);
  const running = useAppStore((state) => ["starting", "running", "waiting"].includes(state.sessions.find((session) => session.id === sessionId)?.status ?? ""));
  const files = undoableFiles(review, path);
  const undone = path ? review.files.some((file) => file.path === path && file.undoneAt) : review.files.length > 0 && review.files.every((file) => file.undoneAt);
  if (undone) return <span className="px-2 py-1.5 ui-caption text-text-muted">{t("undo.done")}</span>;
  if (!files.length) return null;
  /** Read-only look at why undo would be refused (moved HEAD, another session, later edits); nothing is touched (ADR-187). */
  const check = async () => {
    try {
      const found = await client.checkTurnUndo(sessionId, messageId, path ? [path] : undefined);
      setBlock(found);
      return found;
    } catch {
      return null;
    }
  };
  const undo = async () => {
    setError(null);
    try {
      const result = await client.undoTurnChanges(sessionId, messageId, path ? [path] : undefined);
      setOutcome(result);
      return true;
    } catch (reason) {
      // A refusal comes back as a specific message; show it localized when the check can name it.
      const found = await check();
      setError(found ? undoBlockText(found, t) : formatUnknownError(reason));
      return false;
    }
  };
  const open = () => { setOutcome(null); setError(null); setBlock(null); setConfirming(true); void check(); };
  const blockedBy = undoBlockSession(block);
  return <>
    <button type="button" disabled={running} title={block ? undoBlockText(block, t) : t(running ? "undo.wait" : path ? "undo.fileHelp" : "undo.help")} onClick={open} className={className}>
      {t(path ? "undo.file" : "undo.action")}
    </button>
    {outcome?.refused.length ? <span role="status" className="ui-caption text-text-muted">{t("undo.refused", { count: outcome.refused.length })}</span> : null}
    <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={t(path ? "undo.fileTitle" : "undo.title")} description={t("undo.description")} confirmLabel={t(path ? "undo.file" : "undo.action")} onConfirm={undo} disabled={block !== null}>
      {path ? <p className="mb-4 truncate font-mono ui-caption text-text-secondary">{path}</p> : <p className="mb-4 ui-caption text-text-secondary">{t("undo.count", { count: files.length })}</p>}
      {block ? <p role="alert" className="mb-4 ui-caption text-danger">{undoBlockText(block, t)}</p> : null}
      {blockedBy ? <button type="button" className="mb-4 ui-caption text-text-secondary underline" onClick={() => { setConfirming(false); void selectSession(blockedBy); }}>{t("undo.block.open")}</button> : null}
      {error && !block ? <p role="alert" className="mb-4 ui-caption text-danger">{t(error)}</p> : null}
    </ConfirmDialog>
  </>;
}
