import ArcToast from "@/components/arc/toast/toast";
import { useTranslation } from "@/i18n/use-translation";
import { useAppStore } from "@/store/app-store";

/** Mount inside the active page/dialog so modal focus and pointer scopes include dismissal. */
export function ErrorToast() {
  const t = useTranslation();
  const error = useAppStore((state) => state.error);
  if (!error) return null;
  return <div className="fixed top-[8px] left-1/2 z-[100] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2">
    <ArcToast key={error} variant="error" title={t("Something went wrong")} description={t(error)} duration={0}
      dismissLabel={t("common.dismiss")} onOpenChange={(open) => { if (!open) useAppStore.setState({ error: null }); }} />
  </div>;
}
