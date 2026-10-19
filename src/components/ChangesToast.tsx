import ArcToast from "@/components/arc/toast/toast";
import { useTranslation } from "@/i18n/use-translation";
import { useAppStore } from "@/store/app-store";
import { afterToastExit } from "@/lib/toast-exit";

/** The result of discarding changes in the Changes pane: how many files, or the error. */
export function ChangesToast() {
  const t = useTranslation();
  const notice = useAppStore((state) => state.changesNotice);
  if (!notice) return null;
  const failed = notice.variant === "error";
  return <div className="w-full">
    <ArcToast key={notice.id} variant={notice.variant} title={notice.title} description={notice.description} duration={failed ? 8000 : 4500}
      dismissLabel={t("common.dismiss")} onOpenChange={(open) => { if (!open) afterToastExit(() => useAppStore.setState((state) => state.changesNotice?.id === notice.id ? { changesNotice: null } : {})); }} />
  </div>;
}
