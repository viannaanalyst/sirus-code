import { useMemo } from "react";
import type { Message, Session } from "@/client/types";
import { ClipboardList } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { replyChoices } from "@/lib/reply-choices";

/** Event the composer answers: send `text` as the reply, or focus the composer for "Other…" (`text: null`). */
export const QUICK_REPLY_EVENT = "sirus:quick-reply";
/** `planning: false` leaves planning mode first (a plan's "Implement"). */
export type QuickReplyDetail = { sessionId: string; text: string | null; planning?: false };

/**
 * When a finished reply ends by asking the person to choose (in prose, not through the
 * provider's question tool), its options become buttons plus "Other…".
 */
export function ReplyChoices({ session, message }: { session: Pick<Session, "id" | "status">; message: Message }) {
  const t = useTranslation();
  const choices = useMemo(() => message.role === "agent" && !message.streaming ? replyChoices(message.content) : null, [message.role, message.streaming, message.content]);
  if (!choices || ["starting", "running", "waiting"].includes(session.status)) return null;
  const answer = (text: string | null) => window.dispatchEvent(new CustomEvent<QuickReplyDetail>(QUICK_REPLY_EVENT, { detail: { sessionId: session.id, text } }));
  return <div className="reply-choices" role="group" aria-label={choices.question}>
    <p className="reply-choices-question ui-caption">{choices.question}</p>
    <div className="reply-choices-options">
      {choices.options.map((option, index) => <button key={option} type="button" className="reply-choice ui-control" onClick={() => answer(option)}>
        <span className="reply-choice-key">{index + 1}</span><span className="min-w-0 truncate">{option}</span>
      </button>)}
      <button type="button" className="reply-choice reply-choice-other ui-control" onClick={() => answer(null)}>{t("replyChoices.other")}</button>
    </div>
  </div>;
}

/**
 * Under a finished planning turn (after T3 Code): Implement sends "Implement the plan above."
 * with planning switched off; Adjust plan focuses the composer.
 */
export function PlanActions({ session, message }: { session: Pick<Session, "id" | "status" | "execution">; message: Message }) {
  const t = useTranslation();
  if (!session.execution?.planning || message.role !== "agent" || message.streaming || !message.content.trim() || ["starting", "running", "waiting"].includes(session.status)) return null;
  const send = (detail: Omit<QuickReplyDetail, "sessionId">) => window.dispatchEvent(new CustomEvent<QuickReplyDetail>(QUICK_REPLY_EVENT, { detail: { sessionId: session.id, ...detail } }));
  return <div className="plan-actions" role="group" aria-label={t("plan.ready")}>
    <ClipboardList size={14} aria-hidden="true" className="text-text-muted" />
    <span className="ui-caption text-text-muted">{t("plan.ready")}</span>
    <button type="button" className="plan-actions-primary" onClick={() => send({ text: t("plan.implementPrompt"), planning: false })}>{t("plan.implement")}</button>
    <button type="button" className="plan-actions-secondary" onClick={() => send({ text: null })}>{t("plan.adjust")}</button>
  </div>;
}
