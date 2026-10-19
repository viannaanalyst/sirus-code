import { useEffect } from "react";
import { useTranslation } from "@/i18n/use-translation";
import { appUpdatePercent } from "@/lib/app-update";
import { useAppUpdate } from "@/store/app-update-store";
import { InteractiveButton } from "@/primitives/InteractiveButton";

/** The version, the update state and its one action, for Settings → Advanced → About. */
export function AppUpdateControl() {
  const t = useTranslation();
  const status = useAppUpdate((state) => state.status);
  const pending = useAppUpdate((state) => state.pending);
  const bind = useAppUpdate((state) => state.bind);
  const check = useAppUpdate((state) => state.check);
  const install = useAppUpdate((state) => state.install);
  const restart = useAppUpdate((state) => state.restart);
  useEffect(() => bind(), [bind]);
  if (!status) return null;
  const percent = appUpdatePercent(status);
  const state = status.phase === "checking" ? t("appUpdate.checking")
    : status.phase === "upToDate" ? t("appUpdate.upToDate")
    : status.phase === "available" ? t("appUpdate.versionAvailable", { version: status.version ?? "" })
    : status.phase === "downloading" ? (percent === null ? t("appUpdate.downloading", { version: status.version ?? "" }) : t("appUpdate.percent", { percent }))
    : status.phase === "installing" ? t("appUpdate.installing", { version: status.version ?? "" })
    : status.phase === "installed" ? t("appUpdate.restartToFinish")
    : status.phase === "failed" ? t("appUpdate.checkFailed")
    : null;
  const busy = pending || status.phase === "checking" || status.phase === "downloading" || status.phase === "installing";
  const action = status.phase === "available" ? { label: t("appUpdate.update"), run: install }
    : status.phase === "installed" ? { label: t("appUpdate.restart"), run: restart }
    : { label: t("appUpdate.check"), run: check };
  return (
    <>
      <span className={`max-w-[16rem] truncate ui-caption ${status.phase === "failed" ? "text-danger" : "text-text-muted"}`} title={status.error ?? undefined}>
        {t("appUpdate.version", { version: status.currentVersion })}{state ? ` · ${state}` : ""}
      </span>
      <InteractiveButton variant="toolbar" disabled={busy} onClick={() => void action.run()}>{action.label}</InteractiveButton>
    </>
  );
}
