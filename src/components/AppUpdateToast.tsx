import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Download, X } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { motionTokens } from "@/lib/motion";
import { appUpdatePercent, appUpdateSummary, appUpdateToast } from "@/lib/app-update";
import { useAppUpdate } from "@/store/app-update-store";
import { InteractiveButton } from "@/primitives/InteractiveButton";

/** "Sirus Code {version} is available · Update / Later" and the install that follows (ADR-140). */
export function AppUpdateToast() {
  const t = useTranslation();
  const status = useAppUpdate((state) => state.status);
  const dismissed = useAppUpdate((state) => state.dismissed);
  const installRequested = useAppUpdate((state) => state.installRequested);
  const pending = useAppUpdate((state) => state.pending);
  const bind = useAppUpdate((state) => state.bind);
  const install = useAppUpdate((state) => state.install);
  const restart = useAppUpdate((state) => state.restart);
  const later = useAppUpdate((state) => state.later);
  useEffect(() => bind(), [bind]);
  const kind = appUpdateToast(status, dismissed, installRequested);
  const version = status?.version ?? status?.currentVersion ?? "";
  const percent = status ? appUpdatePercent(status) : null;
  const title = kind === "available" ? t("appUpdate.available", { version })
    : kind === "progress" ? t(status?.phase === "installing" ? "appUpdate.installing" : "appUpdate.downloading", { version })
    : kind === "installed" ? t("appUpdate.installed", { version })
    : t("appUpdate.failed");
  const detail = kind === "available" ? appUpdateSummary(status?.notes ?? null)
    : kind === "installed" ? t("appUpdate.installedHelp")
    : kind === "failed" ? status?.error ?? null
    : null;
  return (
    <AnimatePresence>
      {kind && status ? (
        <motion.div
          key="app-update-toast"
          className="w-full"
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: motionTokens.fast, ease: motionTokens.ease }}
        >
          <div role="status" className="floating-material rounded-[12px] border border-border-default bg-background-1 p-3 shadow-[var(--shadow-float)]">
            <div className="flex items-start gap-2">
              <Download size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="ui-control font-medium">{title}</p>
                {detail ? <p className={`mt-0.5 line-clamp-3 break-words ui-caption ${kind === "failed" ? "text-danger" : "text-text-muted"}`}>{detail}</p> : null}
              </div>
              {kind !== "progress" ? (
                <button
                  type="button"
                  aria-label={t("common.dismiss")}
                  className="rounded-[6px] p-0.5 text-text-muted transition-colors duration-[var(--motion-fast)] hover:bg-background-3 hover:text-text-primary"
                  onClick={() => later(kind)}
                >
                  <X size={13} />
                </button>
              ) : null}
            </div>
            {kind === "progress" ? (
              <div className="mt-2.5 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-background-3" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-[var(--motion-fast)]"
                    style={{ width: `${status.phase === "installing" ? 100 : percent ?? 8}%` }}
                  />
                </div>
                {percent !== null && status.phase === "downloading" ? <span className="ui-caption tabular-nums text-text-muted">{t("appUpdate.percent", { percent })}</span> : null}
              </div>
            ) : kind === "available" || kind === "installed" ? (
              <div className="mt-2.5 flex items-center gap-1.5">
                <button
                  type="button"
                  className="rounded-[6px] px-1.5 py-1 ui-control text-text-secondary transition-colors duration-[var(--motion-fast)] hover:bg-background-3 hover:text-text-primary"
                  onClick={() => later(kind)}
                >
                  {t("appUpdate.later")}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  className="ml-auto rounded-[8px] bg-accent px-2.5 py-1 ui-control font-medium text-background-0 transition-opacity duration-[var(--motion-fast)] hover:opacity-90 disabled:opacity-50"
                  onClick={() => void (kind === "installed" ? restart() : install())}
                >
                  {kind === "installed" ? t("appUpdate.restart") : t("appUpdate.update")}
                </button>
              </div>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

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
