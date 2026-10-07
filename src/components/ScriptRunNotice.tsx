import { useId, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Session } from "@/client/types";
import { CircleCheck, FileTerminal, LoaderCircle, RotateCw, Square, TriangleAlert, X } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { visibleScriptRun } from "@/lib/project-scripts";
import { useAppStore } from "@/store/app-store";
import "@/styles/context-meter.css";

/** Above the composer: the latest project Setup / On finish run in this session's worktree (ADR-074). */
export function ScriptRunNotice({ session }: { session: Session }) {
  const t = useTranslation();
  const outputId = useId();
  const [open, setOpen] = useState(false);
  const run = visibleScriptRun(session);
  if (!run) return null;
  const store = useAppStore.getState();
  const running = run.status === "running";
  const failed = run.status === "failed" || run.status === "timedOut";
  const busy = ["starting", "running", "waiting"].includes(session.status);
  const Icon = running ? LoaderCircle : failed ? TriangleAlert : run.status === "succeeded" ? CircleCheck : FileTerminal;
  const detail = [run.exitCode != null && run.status === "failed" ? t("scripts.exit", { code: String(run.exitCode) }) : null, failed ? t("scripts.continues") : null].filter(Boolean).join(" · ");
  return <section aria-label={t(`scripts.${run.kind}`)} data-status={run.status} className="script-run mx-auto mb-2 w-full max-w-[var(--chat-column-width)] rounded-2xl border px-3 py-2">
    <div className="flex items-center gap-2">
      <Icon size={15} aria-hidden="true" className={running ? "script-run-icon animate-spin" : "script-run-icon"} />
      <span role="status" className="min-w-0 truncate ui-control text-text-primary">{t(`scripts.${run.status}.${run.kind}`)}</span>
      {detail ? <span className="min-w-0 flex-1 truncate ui-caption text-text-muted">{detail}</span> : <span className="flex-1" />}
      {!running ? <button type="button" aria-expanded={open} aria-controls={outputId} className="usage-limit-action ui-caption" onClick={() => setOpen(!open)}>{t(open ? "scripts.hideOutput" : "scripts.output")}</button> : null}
      {running ? <button type="button" className="usage-limit-action ui-caption" onClick={() => void store.projectScriptAction({ type: "cancel", sessionId: session.id })}><Square size={12} aria-hidden="true" />{t("scripts.stop")}</button>
        : failed || run.status === "cancelled" ? <button type="button" disabled={busy} className="usage-limit-action ui-caption" onClick={() => { setOpen(false); void store.projectScriptAction({ type: "run", sessionId: session.id, kind: run.kind }); }}><RotateCw size={13} aria-hidden="true" />{t("scripts.runAgain")}</button> : null}
      {!running ? <button type="button" aria-label={t("scripts.dismiss")} className="usage-limit-close" onClick={() => void store.projectScriptAction({ type: "dismiss", sessionId: session.id, kind: run.kind })}><X size={13} aria-hidden="true" /></button> : null}
    </div>
    <AnimatePresence initial={false}>
      {open && !running ? <motion.div key="output" id={outputId} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }} className="overflow-hidden">
        <pre className="script-run-output selectable mt-2 max-h-56 overflow-auto rounded-lg p-2 font-mono ui-caption text-text-secondary">{run.output || t("scripts.noOutput")}</pre>
      </motion.div> : null}
    </AnimatePresence>
  </section>;
}
