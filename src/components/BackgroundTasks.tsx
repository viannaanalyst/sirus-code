import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Message, Session } from "@/client/types";
import { client } from "@/client";
import { ChevronDown, Square } from "@/components/icons";
import { useTranslation } from "@/i18n/use-translation";
import { formatActivityDuration } from "@/lib/agent-activity";
import { useAmbientActive } from "@/lib/ambient-motion";
import { backgroundTaskId, runningBackground } from "@/lib/background-tasks";
import { cascadeIndex, useCascade } from "@/lib/cascade";
import { formatUnknownError } from "@/lib/format-error";
import { useAppStore } from "@/store/app-store";

const active = (status: Session["status"]) => status === "starting" || status === "running" || status === "waiting";

/**
 * "In the background" (ADR-097): the running reply's background subagents. At rest a capsule
 * above the composer ("2 in the background"); opened, a card where each row
 * has its status dot, name, what it is doing now, its time and a stop for that task alone.
 * Hidden when none runs.
 */
/** Starts as the "N in the background" pill; `initiallyExpanded` opens the list (render checks). */
export function BackgroundTasks({ session, message, initiallyExpanded = false }: { session: Pick<Session, "id" | "status">; message: Message | undefined; initiallyExpanded?: boolean }) {
  const t = useTranslation();
  const tasks = active(session.status) && message?.role === "agent" ? runningBackground(message.activity) : [];
  const open = tasks.length > 0;
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const cascade = useCascade(open);
  // Its own clock, only while shown: the conversation does not re-render each second.
  const ambient = useAmbientActive();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open || !ambient || !expanded) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open, ambient, expanded]);
  const [stopping, setStopping] = useState<ReadonlySet<string>>(() => new Set());
  const stop = (id: string) => {
    setStopping((current) => new Set(current).add(id));
    void client.stopBackgroundTask(session.id, backgroundTaskId({ id })).catch((error: unknown) => {
      useAppStore.setState({ error: formatUnknownError(error) });
      setStopping((current) => { const next = new Set(current); next.delete(id); return next; });
    });
  };
  return <AnimatePresence initial={false}>
    {open && !expanded ? <motion.div key="capsule" className="background-tasks-dock" data-background-tasks initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
      <button type="button" className="composer-capsule" aria-expanded={false} onClick={() => setExpanded(true)}>
        <span className="background-task-dot" aria-hidden="true" />{t("background.capsule", { count: tasks.length })}
      </button>
    </motion.div> : null}
    {open && expanded ? <motion.div key="background" className="background-tasks-dock" data-background-tasks initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
      <section className="background-tasks" aria-label={t("background.title")} data-cascade={cascade || undefined}>
        <header className="background-tasks-head">
          <span className="background-tasks-title">{t("background.title")}</span>
          <span className="background-tasks-count">{tasks.length}</span>
          <button type="button" className="background-tasks-collapse" aria-label={t("background.collapse")} title={t("background.collapse")} onClick={() => setExpanded(false)}><ChevronDown size={12} aria-hidden="true" /></button>
        </header>
        <ol className="background-tasks-list">
          <AnimatePresence initial={false}>
            {tasks.map((item, index) => {
              const name = item.label.trim() || t("background.unnamed");
              const elapsed = item.startedAt ? formatActivityDuration(Math.floor((now - item.startedAt) / 1000)) : "";
              return <motion.li key={item.id} className="background-task" data-cascade-item style={cascadeIndex(index)} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}>
                <span className="background-task-dot" aria-hidden="true" />
                <span className="background-task-body">
                  <span className="background-task-name">{name}</span>
                  {item.detail ? <span className="background-task-detail">{item.detail}</span> : null}
                </span>
                <span className="background-task-time">{elapsed}</span>
                <button type="button" className="background-task-stop" aria-label={t("background.stop", { name })} title={t("background.stop", { name })} disabled={stopping.has(item.id)} onClick={() => stop(item.id)}>
                  <Square size={10} aria-hidden="true" />
                </button>
              </motion.li>;
            })}
          </AnimatePresence>
        </ol>
      </section>
    </motion.div> : null}
  </AnimatePresence>;
}
