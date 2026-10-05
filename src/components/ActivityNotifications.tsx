import ArcToast from "@/components/arc/toast/toast";
import { useCallback, useMemo } from "react";
import type { ActivityNotification } from "@/client/types";
import { notificationLifetime, retainActivityNotifications } from "@/lib/notifications";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { useTranslation } from "@/i18n/use-translation";
import { afterToastExit } from "@/lib/toast-exit";
import { useAppStore, selectSessionsMeta } from "@/store/app-store";

function dismiss(id: string) { useAppStore.setState(state => ({ activityNotifications: state.activityNotifications.filter(notice => notice.id !== id) })); }
function NoticeCard({ notice }: { notice: ActivityNotification }) {
  const t = useTranslation();
  const close = useCallback((open: boolean) => { if (!open) afterToastExit(() => dismiss(notice.id)); }, [notice.id]);
  const duration = useMemo(() => Math.max(1, notice.createdAt + notificationLifetime(notice) - Date.now()), [notice]);
  return <div>
    <ArcToast title={notice.title} description={notice.body} variant={notice.kind === "completion" ? "success" : "info"} duration={duration} dismissLabel={t("common.dismiss")} onOpenChange={close} />
    <InteractiveButton variant="secondary" glow={false} className="mt-1" onClick={() => {
      const store = useAppStore.getState(); store.setSettingsOpen(false); void store.selectSession(notice.sessionId); dismiss(notice.id);
    }}>{t("Open session")}</InteractiveButton>
  </div>;
}

export function ActivityNotifications() {
  const t = useTranslation();
  const notices = useAppStore(state => state.activityNotifications);
  const sessions = useAppStore(selectSessionsMeta);
  const prefs = useAppStore(state => state.settings.notifications);
  const visible = retainActivityNotifications(notices, prefs).filter(notice => sessions.some(session => session.id === notice.sessionId)).slice(-3);
  return <div aria-label={t("Activity alerts")} className="flex w-full flex-col gap-2 empty:hidden">
    {visible.map(notice => <NoticeCard key={notice.id} notice={notice} />)}
  </div>;
}
