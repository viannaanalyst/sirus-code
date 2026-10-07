import { useMemo } from "react";
import type { Message, Session } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { replyChoices } from "@/lib/reply-choices";

/** Event the composer answers: send `text` as the reply, or focus the composer for "Other…" (`text: null`). */
export const QUICK_REPLY_EVENT = "sirus:quick-reply";
export type QuickReplyDetail = { sessionId: string; text: string | null };

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
