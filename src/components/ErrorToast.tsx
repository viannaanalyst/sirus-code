import ArcToast from "@/components/arc/toast/toast";
import { isRemoteUi } from "@/client";
import { isRemoteConnectionError } from "@/client/remote-transport";
import { useTranslation } from "@/i18n/use-translation";
import { useAppStore } from "@/store/app-store";
import { afterToastExit } from "@/lib/toast-exit";

/** Mount inside the active page/dialog (in a TopToastStack) so modal focus and pointer scopes include dismissal. */
export function ErrorToast() {
  const t = useTranslation();
  const error = useAppStore((state) => state.error);
  // On a phone, losing the Mac shows as "reconnecting"; a toast for each failed call is noise.
  if (!error || (isRemoteUi && isRemoteConnectionError(error))) return null;
  return <div className="w-full">
    <ArcToast key={error} variant="error" title={t("Something went wrong")} description={t(error)} duration={0}
      dismissLabel={t("common.dismiss")} onOpenChange={(open) => { if (!open) afterToastExit(() => useAppStore.setState((state) => state.error === error ? { error: null } : {})); }} />
  </div>;
}
