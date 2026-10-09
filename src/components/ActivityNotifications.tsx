import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ActivityNotification } from "@/client/types";
import { notificationLifetime, retainActivityNotifications } from "@/lib/notifications";
import { useTranslation } from "@/i18n/use-translation";
import { useAppStore, selectSessionsMeta } from "@/store/app-store";
import "@/styles/activity-notifications.css";

function dismiss(id: string) { useAppStore.setState(state => ({ activityNotifications: state.activityNotifications.filter(notice => notice.id !== id) })); }

function openSession(notice: ActivityNotification) {
  const store = useAppStore.getState();
  store.setSettingsOpen(false);
  void store.selectSession(notice.sessionId);
  dismiss(notice.id);
}

const badge: Record<ActivityNotification["kind"], string> = { completion: "✓", failure: "!", permission: "?", question: "?", reminder: "☾" };

/** "agora", "2 min": when the notice arrived, kept short like a macOS notification. */
function useAge(createdAt: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  return Math.max(0, Math.floor((now - createdAt) / 60_000));
}

/**
 * A notice in the macOS notification style (2026-10-08, option C): glass, the app icon with a
 * small state badge, title, time and text. The whole card opens the session; × shows on hover.
 */
function NoticeCard({ notice }: { notice: ActivityNotification }) {
  const t = useTranslation();
  const minutes = useAge(notice.createdAt);
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(notice.id), Math.max(1, notice.createdAt + notificationLifetime(notice) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [notice]);
  return <motion.div layout className="activity-notice" data-kind={notice.kind}
    initial={{ opacity: 0, y: -14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.18 } }}
    transition={{ type: "spring", stiffness: 420, damping: 30 }}>
    <button type="button" className="activity-notice-open" aria-label={`${notice.title}. ${notice.body}. ${t("Open session")}`} onClick={() => openSession(notice)}>
      <span className="activity-notice-app" aria-hidden="true"><img src="/sirus-glyph.png" alt="" draggable={false} /><span className="activity-notice-badge">{badge[notice.kind]}</span></span>
      <span className="activity-notice-text">
        <span className="activity-notice-top"><span className="activity-notice-title">{notice.title}</span><span className="activity-notice-when">{minutes < 1 ? t("notice.now") : t("notice.minutes", { count: String(minutes) })}</span></span>
        <span className="activity-notice-body">{notice.body}</span>
      </span>
    </button>
    <button type="button" className="activity-notice-close" aria-label={t("notice.dismiss")} onClick={() => dismiss(notice.id)}>✕</button>
  </motion.div>;
}

export function ActivityNotifications() {
  const t = useTranslation();
  const notices = useAppStore(state => state.activityNotifications);
  const sessions = useAppStore(selectSessionsMeta);
  const prefs = useAppStore(state => state.settings.notifications);
  const visible = retainActivityNotifications(notices, prefs).filter(notice => sessions.some(session => session.id === notice.sessionId)).slice(-3);
  return <div aria-label={t("Activity alerts")} className="flex w-full flex-col items-center gap-2 empty:hidden">
    <AnimatePresence initial={false}>
      {visible.map(notice => <NoticeCard key={notice.id} notice={notice} />)}
    </AnimatePresence>
  </div>;
}
