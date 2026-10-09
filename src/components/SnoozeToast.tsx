import ArcToast from "@/components/arc/toast/toast";
import { useTranslation } from "@/i18n/use-translation";
import { openTab } from "@/lib/header-tabs";
import { snoozeDeadline } from "@/lib/snooze";
import { afterToastExit } from "@/lib/toast-exit";
import { useAppStore } from "@/store/app-store";

/** "Conversation snoozed until tomorrow at 9 AM · Undo" after a snooze (ADR-103). */
export function SnoozeToast() {
  const t = useTranslation();
  const notice = useAppStore((state) => state.snoozeNotice);
  const locale = useAppStore((state) => state.settings.locale);
  if (!notice) return null;
  const clear = () => afterToastExit(() => useAppStore.setState((state) => state.snoozeNotice?.id === notice.id ? { snoozeNotice: null } : {}));
  const undo = () => {
    void useAppStore.getState().snoozeSession(notice.sessionId, null).then((done) => {
      if (!done) return;
      if (notice.wasSelected) { void useAppStore.getState().selectSession(notice.sessionId); return; }
      // Its tab comes back too, without taking the selection.
      useAppStore.setState((state) => {
        const session = state.sessions.find((item) => item.id === notice.sessionId);
        if (!session) return {};
        return { openTabsByProject: { ...state.openTabsByProject, [session.projectId]: openTab(state.openTabsByProject[session.projectId] ?? [], session.id, state.selectedSessionId) } };
      });
    });
  };
  return <div className="w-full">
    <ArcToast key={notice.id} variant="info" title={t("snooze.toast", { when: snoozeDeadline(new Date(notice.until), new Date(), locale, t) })} duration={6000}
      dismissLabel={t("common.dismiss")} action={{ label: t("snooze.undo"), onSelect: undo }} onOpenChange={(open) => { if (!open) clear(); }} />
  </div>;
}
