import { useEffect, useState } from "react";
import { RefreshCw } from "@/components/icons/phosphor";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { orderedUsageWindows, resetDuration, USAGE_PROVIDER_IDS, usageWindowLabel } from "@/lib/provider-usage";
import { providerById } from "@/lib/provider-registry";
import { isProviderEnabled } from "@/lib/settings";
import { useAppStore } from "@/store/app-store";

/** Provider usage and limits on the phone (ADR-086): each window as a bar with its reset. */
export function MobileUsage() {
  const t = useTranslation();
  const agents = useAppStore((state) => state.agents);
  const settings = useAppStore((state) => state.settings);
  const usage = useAppStore((state) => state.usageByProvider);
  const loading = useAppStore((state) => state.usageLoading);
  const [now, setNow] = useState(() => Date.now());
  const providers = USAGE_PROVIDER_IDS.filter((id) => agents.some((agent) => agent.id === id && agent.installed) && isProviderEnabled(settings, id));
  const refresh = (force: boolean) => { setNow(Date.now()); for (const id of providers) void useAppStore.getState().refreshProviderUsage(id, force); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once the providers are known
  useEffect(() => refresh(false), [providers.join(",")]);

  if (!providers.length) return null;
  return <section>
    <h2 className="mobile-usage-title">{t("mobile.usage")}<button type="button" aria-label={t("mobile.refresh")} onClick={() => refresh(true)}><RefreshCw size={14} aria-hidden="true" className={providers.some((id) => loading[id]) ? "animate-spin" : undefined} /></button></h2>
    <div className="mobile-card">
      {providers.map((id) => {
        const data = usage[id];
        const windows = orderedUsageWindows(data).filter((window) => window.usedPercent !== null);
        return <div key={id} className="mobile-usage">
          <div className="mobile-usage-head"><ProviderIcon id={id} size={18} /><span className="mobile-option-title">{providerById(id).name}</span>{data?.account?.plan ? <span className="mobile-option-help">{data.account.plan}</span> : null}</div>
          {windows.length ? windows.map((window) => {
            const used = Math.max(0, Math.min(100, Math.round(window.usedPercent ?? 0)));
            const reset = resetDuration(window.resetsAt, now);
            return <div key={window.id} className="mobile-usage-window">
              <div className="mobile-usage-row"><span>{t(usageWindowLabel(window))}</span><span>{used}%</span></div>
              <div className="mobile-usage-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={used} aria-label={t(usageWindowLabel(window))}><span style={{ width: `${used}%` }} data-level={used >= 90 ? "high" : used >= 70 ? "mid" : undefined} /></div>
              {reset ? <p className="mobile-option-help">{t("mobile.resetsIn", { time: reset })}</p> : null}
            </div>;
          }) : <p className="mobile-option-help">{loading[id] ? t("common.loading") : data?.note ?? t("mobile.usageUnavailable")}</p>}
        </div>;
      })}
    </div>
  </section>;
}
