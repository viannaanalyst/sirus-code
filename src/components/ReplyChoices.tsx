import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Message, Session } from "@/client/types";
import { Check, ClipboardList } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { codexFollowups } from "@/lib/codex-directives";
import { replyChoices } from "@/lib/reply-choices";

/** Event the composer answers: send `text` as the reply, or focus the composer for "Other…" (`text: null`). */
export const QUICK_REPLY_EVENT = "sirus:quick-reply";
/** `planning: false` leaves planning mode first (a plan's "Implement"). */
export type QuickReplyDetail = { sessionId: string; text: string | null; planning?: false };
/** Replies whose choices were cancelled stay closed while the app runs, across session switches. */
const dismissed = new Set<string>();

/**
 * When a finished reply ends by asking the person to choose (in prose, not through the
 * provider's question tool), its options become choices plus "Other…", in a tab attached
 * to the top of the composer, where the provider's own questions appear too. A choice is
 * marked first and goes out with Send; "Other…" opens a field for a written answer.
 */
export function ReplyChoices({ session, message }: { session: Pick<Session, "id" | "status">; message: Message | undefined }) {
  const t = useTranslation();
  // Codex's suggested next steps come first; each sends its full prompt (codex-directives).
  const choices = useMemo(() => {
    if (message?.role !== "agent" || message.streaming) return null;
    const followups = codexFollowups(message.content);
    if (followups.length) return { label: t("replyChoices.suggests"), question: t("replyChoices.nextSteps"), options: followups.map((item) => item.label), prompts: followups.map((item) => item.prompt) };
    const found = replyChoices(message.content);
    return found ? { ...found, label: t("replyChoices.label"), prompts: found.options } : null;
  }, [message?.role, message?.streaming, message?.content, t]);
  const messageId = message?.id;
  const [cancelled, setCancelled] = useState(() => Boolean(messageId && dismissed.has(messageId)));
  const shown = choices && !cancelled && !["starting", "running", "waiting"].includes(session.status) ? choices : null;
  const [picked, setPicked] = useState<number | "other" | null>(null);
  const [written, setWritten] = useState("");
  useEffect(() => { setPicked(null); setWritten(""); setCancelled(Boolean(messageId && dismissed.has(messageId))); }, [messageId]);
  const cancel = () => {
    if (messageId) dismissed.add(messageId);
    setCancelled(true);
  };
  const reply = picked === "other" ? written.trim() : picked !== null && shown ? shown.prompts[picked] ?? shown.options[picked] : "";
  const send = () => {
    if (!reply) return;
    window.dispatchEvent(new CustomEvent<QuickReplyDetail>(QUICK_REPLY_EVENT, { detail: { sessionId: session.id, text: reply } }));
    setPicked(null);
    setWritten("");
  };
  return <AnimatePresence initial={false}>
    {shown && message ? <motion.div key={message.id} className="reply-choices-dock" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
      <div className="reply-choices" role="group" aria-label={shown.question}>
        <p className="reply-choices-label ui-micro">{shown.label}</p>
        <p className="reply-choices-question">{shown.question}</p>
        <div className="reply-choices-options">
          {shown.options.map((option, index) => <button key={option} type="button" className="reply-choice ui-control" aria-pressed={picked === index} title={shown.prompts[index] === option ? undefined : shown.prompts[index]} onClick={() => setPicked(picked === index ? null : index)}>
            <span className="reply-choice-key">{index + 1}</span><span className="min-w-0 flex-1 truncate">{option}</span>
            {picked === index ? <Check size={14} aria-hidden="true" className="reply-choice-check" /> : null}
          </button>)}
          {picked === "other"
            ? <input className="reply-choice reply-choice-other reply-choice-input ui-control" autoFocus value={written} placeholder={t("replyChoices.otherPlaceholder")} aria-label={t("replyChoices.other")} maxLength={4000}
                onChange={(event) => setWritten(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
                  if (event.key === "Escape") { event.preventDefault(); setPicked(null); }
                }} />
            : <button type="button" className="reply-choice reply-choice-other ui-control" onClick={() => setPicked("other")}>{t("replyChoices.other")}</button>}
        </div>
        <div className="reply-choices-actions">
          <button type="button" className="reply-choices-cancel ui-control" onClick={cancel}>{t("replyChoices.cancel")}</button>
          <button type="button" className="reply-choices-send ui-control" disabled={!reply} onClick={send}>{t("replyChoices.send")}</button>
        </div>
      </div>
    </motion.div> : null}
  </AnimatePresence>;
}

/**
 * Under a finished planning turn: Implement sends "Implement the plan above."
 * with planning switched off; Adjust plan focuses the composer.
 */
export function PlanActions({ session, message }: { session: Pick<Session, "id" | "status" | "execution" | "team">; message: Message }) {
  const t = useTranslation();
  // A team plan has its own Confirm and start (ADR-043).
  if (!session.execution?.planning || session.team || message.role !== "agent" || message.streaming || !message.content.trim() || ["starting", "running", "waiting"].includes(session.status)) return null;
  const send = (detail: Omit<QuickReplyDetail, "sessionId">) => window.dispatchEvent(new CustomEvent<QuickReplyDetail>(QUICK_REPLY_EVENT, { detail: { sessionId: session.id, ...detail } }));
  return <div className="plan-actions" role="group" aria-label={t("plan.ready")}>
    <ClipboardList size={14} aria-hidden="true" className="text-text-muted" />
    <span className="ui-caption text-text-muted">{t("plan.ready")}</span>
    <button type="button" className="plan-actions-primary" onClick={() => send({ text: t("plan.implementPrompt"), planning: false })}>{t("plan.implement")}</button>
    <button type="button" className="plan-actions-secondary" onClick={() => send({ text: null })}>{t("plan.adjust")}</button>
  </div>;
}
