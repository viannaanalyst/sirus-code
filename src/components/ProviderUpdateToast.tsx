import { TriangleAlert, X } from "@/components/icons/phosphor";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { providerById } from "@/lib/provider-registry";
import { motionTokens } from "@/lib/motion";
import { useTranslation } from "@/i18n/use-translation";
import { useAppStore } from "@/store/app-store";

/** Persistent provider CLI update prompt with Review / Update all actions. */
export function ProviderUpdateToast() {
  const t = useTranslation();
  const updates = useAppStore((state) => state.providerUpdates);
  const enabled = useAppStore((state) => state.settings.enableProviderUpdateChecks);
  const applying = useAppStore((state) => state.updatesApplying);
  const updateError = useAppStore((state) => state.updateError);
  const applyProviderUpdates = useAppStore((state) => state.applyProviderUpdates);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const setSettingsSection = useAppStore((state) => state.setSettingsSection);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const outdated = (updates ?? []).filter((update) => update.updateAvailable);
  const updatable = outdated.filter((update) => update.updateSupported);
  const key = outdated.map((update) => `${update.provider}@${update.latestVersion ?? ""}`).sort().join(",");
  const visible = enabled && outdated.length > 0 && dismissed !== key;
  const providerName = outdated[0] ? providerById(outdated[0].provider).name : "";
  const title = outdated.length === 1
    ? t("{provider} update available", { provider: providerName })
    : t("{count} provider updates available", { count: outdated.length });
  const description = outdated.length === 1
    ? t("{provider} has a newer version available.", { provider: providerName })
    : t("{provider} and {count} more providers have newer versions available.", { provider: providerName, count: outdated.length - 1 });
  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="provider-update-toast"
          className="w-full"
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: motionTokens.fast, ease: motionTokens.ease }}
        >
      <div className="floating-material rounded-[12px] border border-border-default bg-background-1 p-3 shadow-[var(--shadow-float)]">
        <div className="flex items-start gap-2">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="ui-control font-medium">{title}</p>
            <p className="mt-0.5 ui-caption text-text-muted">{description}</p>
          </div>
          <button
            type="button"
            aria-label={t("common.dismiss")}
            className="rounded-[6px] p-0.5 text-text-muted transition-colors duration-[var(--motion-fast)] hover:bg-background-3 hover:text-text-primary"
            onClick={() => setDismissed(key)}
          >
            <X size={13} />
          </button>
        </div>
        <div className="mt-2.5 flex items-center gap-1.5">
          <button
            type="button"
            className="rounded-[6px] px-1.5 py-1 ui-control text-text-secondary transition-colors duration-[var(--motion-fast)] hover:bg-background-3 hover:text-text-primary"
            onClick={() => {
              setSettingsSection("providers");
              setSettingsOpen(true);
            }}
          >
            {t("Review updates")}
          </button>
          {updatable.length > 0 ? (
            <button
              type="button"
              disabled={applying}
              className="ml-auto rounded-[8px] bg-accent px-2.5 py-1 ui-control font-medium text-background-0 transition-opacity duration-[var(--motion-fast)] hover:opacity-90 disabled:opacity-50"
              onClick={() => void applyProviderUpdates()}
            >
              {applying ? t("Updating…") : t("Update all")}
            </button>
          ) : null}
        </div>
        {updatable.length === 0 ? (
          <p className="mt-2 ui-caption text-text-muted">{t("A newer version is available, but Switchyard could not identify a safe one-click update command for this installation.")}</p>
        ) : null}
        {updateError ? (
          <motion.p
            role="alert"
            className="mt-2 break-words ui-caption text-danger"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: motionTokens.fast, ease: motionTokens.ease }}
          >
            {updateError}
          </motion.p>
        ) : null}
      </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
