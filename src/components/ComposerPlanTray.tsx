import { useEffect, useId, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, CircleDashed, ListOrdered, X } from "@/components/icons";
import type { PlanEntry } from "@/client/types";
import { useAppStore } from "@/store/app-store";
import { useTranslation } from "@/i18n/use-translation";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { motionTokens } from "@/lib/motion";
import { isActivityActive } from "@/lib/agent-activity";
import { latestPlan, planProgress, planSignature, planVisible } from "@/lib/agent-plan";

/** Dismissed plans per conversation, for this run of the app: a new or changed plan shows again. */
const dismissals = new Map<string, string>();

/** The agent's own to-do plan above the composer: one line that opens into the checklist (ADR-182). */
export function ComposerPlanTray({ sessionId }: { sessionId: string }) {
  const t = useTranslation();
  const reduced = useMotionPreferences();
  const messages = useAppStore(state => state.sessions.find(item => item.id === sessionId)?.messages);
  const status = useAppStore(state => state.sessions.find(item => item.id === sessionId)?.status);
  const plan = useMemo(() => latestPlan(messages ?? []), [messages]);
  const signature = useMemo(() => planSignature(plan), [plan]);
  const [dismissed, setDismissed] = useState(() => dismissals.get(sessionId));
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const live = status ? isActivityActive(status) : false;
  const visible = planVisible(plan, status, dismissed);
  // A different plan brings the tray back.
  useEffect(() => { if (dismissed !== undefined && dismissed !== signature) { dismissals.delete(sessionId); setDismissed(undefined); } }, [dismissed, signature, sessionId]);
  const progress = planProgress(plan);
  const summary = progress.complete ? t("plan.allDone") : progress.current?.text;
  return <AnimatePresence initial={false}>
    {visible ? <motion.section key="plan" data-plan-tray="" aria-label={t("plan.title")}
      className="plan-tray mx-auto mb-2 w-full max-w-[var(--chat-column-width)]"
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
      transition={{ duration: reduced ? 0 : motionTokens.fast, ease: motionTokens.ease }}>
      <div className="plan-tray-head">
        <button type="button" className="plan-tray-toggle ui-control" aria-expanded={open} aria-controls={bodyId} title={t(open ? "plan.collapse" : "plan.expand")} onClick={() => setOpen(value => !value)}>
          <ListOrdered size={15} aria-hidden="true" className="plan-tray-icon" />
          <span className="plan-tray-count tabular-nums">{t("plan.progress", { done: progress.done, total: progress.total })}</span>
          {summary ? <span className="plan-tray-current" data-live={(live && progress.current?.status === "inProgress") || undefined}>{summary}</span> : null}
          <ChevronDown size={14} aria-hidden="true" className={`plan-tray-chevron${open ? " open" : ""}`} />
        </button>
        <button type="button" className="plan-tray-dismiss" aria-label={t("plan.dismiss")} title={t("plan.dismiss")} onClick={() => { dismissals.set(sessionId, signature); setDismissed(signature); }}><X size={13} aria-hidden="true" /></button>
      </div>
      <AnimatePresence initial={false}>
        {open ? <motion.ol key="list" id={bodyId} className="plan-tray-list scroll-thin"
          initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
          transition={{ duration: reduced ? 0 : motionTokens.fast, ease: motionTokens.ease }}>
          {plan.map((entry, index) => <PlanRow key={`${index}:${entry.text}`} entry={entry} live={live} label={t(`plan.status.${entry.status}`)} />)}
        </motion.ol> : null}
      </AnimatePresence>
    </motion.section> : null}
  </AnimatePresence>;
}

function PlanRow({ entry, live, label }: { entry: PlanEntry; live: boolean; label: string }) {
  return <li className="plan-tray-row ui-control" data-status={entry.status} data-live={live || undefined} aria-current={entry.status === "inProgress" ? "step" : undefined}>
    <span className="plan-tray-mark" role="img" aria-label={label}>
      {entry.status === "completed" ? <Check size={12} aria-hidden="true" /> : entry.status === "inProgress" ? <span className="plan-tray-pulse" /> : <CircleDashed size={12} aria-hidden="true" />}
    </span>
    <span className="plan-tray-text">{entry.text}</span>
  </li>;
}
