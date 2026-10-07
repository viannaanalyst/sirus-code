import ArcToast from "@/components/arc/toast/toast";
import { useTranslation } from "@/i18n/use-translation";
import { worktreeReleaseText } from "@/lib/project-scripts";
import { useAppStore } from "@/store/app-store";
import { afterToastExit } from "@/lib/toast-exit";

/** Says whether archiving released the session's worktree, or why it was kept (ADR-078). */
export function WorktreeReleaseToast() {
  const t = useTranslation();
  const notice = useAppStore((state) => state.worktreeReleaseNotice);
  if (!notice) return null;
  const text = worktreeReleaseText(notice.release);
  const released = notice.release.outcome === "released";
  return <div className="w-full">
    <ArcToast key={notice.id} variant={released ? "success" : "info"} title={t(text.title)} description={t(text.description, text.values)} duration={released ? 4500 : 8000}
      dismissLabel={t("common.dismiss")} onOpenChange={(open) => { if (!open) afterToastExit(() => useAppStore.setState((state) => state.worktreeReleaseNotice?.id === notice.id ? { worktreeReleaseNotice: null } : {})); }} />
  </div>;
}
