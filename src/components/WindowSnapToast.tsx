import ArcToast from "@/components/arc/toast/toast";
import { useTranslation } from "@/i18n/use-translation";
import { useAppStore } from "@/store/app-store";
import { afterToastExit } from "@/lib/toast-exit";

/** Confirms a global window snap (ADR-054) or says why it did not happen. */
export function WindowSnapToast() {
  const t = useTranslation();
  const notice = useAppStore((state) => state.windowSnapNotice);
  if (!notice) return null;
  const added = notice.kind === "added";
  return <div className="w-full">
    <ArcToast key={notice.id} variant={added ? "success" : "info"} title={t(added ? "windowSnap.added" : "windowSnap.notAdded")}
      description={added ? t("windowSnap.addedHelp", { app: notice.app ?? "" }) : t(`windowSnap.${notice.kind}`)} duration={added ? 3500 : 6000}
      dismissLabel={t("common.dismiss")} onOpenChange={(open) => { if (!open) afterToastExit(() => useAppStore.setState((state) => state.windowSnapNotice?.id === notice.id ? { windowSnapNotice: null } : {})); }} />
  </div>;
}
