import { memo, useEffect } from "react";
import type { AgentProviderId } from "@/client/types";
import { ProviderUsagePanel } from "@/components/ProviderUsagePanel";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";
import { modelBrandAsset } from "@/lib/model-brand";
import { providerById } from "@/lib/provider-registry";
import { tightestUsageWindow, usageWindowLabel } from "@/lib/provider-usage";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { useAppStore } from "@/store/app-store";

/** Ring colour per provider; a nearly exhausted quota turns the ring red. */
const RING_COLOR: Partial<Record<AgentProviderId, string>> = {
  codex: "var(--brand-openai)",
  claude: "var(--brand-claude)",
  cursor: "var(--brand-cursor)",
  opencode: "var(--text-secondary)",
};
const DANGER_PERCENT = 90;
const RADIUS = 14;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const ringColor = (provider: AgentProviderId, used: number | null | undefined) =>
  used != null && used >= DANGER_PERCENT ? "var(--danger)" : RING_COLOR[provider] ?? "var(--text-secondary)";

/**
 * Quota rings for the providers chosen in Settings, at the foot of the sidebar
 * rail. Refreshes follow the usage footer: on mount, when the window becomes
 * visible again and after a turn ends. No polling.
 */
function SidebarUsageRingsView() {
  const providers = useAppStore((state) => state.settings.sidebarUsageProviders);
  const disabled = useAppStore((state) => state.settings.disabledProviders);
  const refresh = useAppStore((state) => state.refreshProviderUsage);
  const visible = providers.filter((id) => !disabled.includes(id));
  const scope = visible.join(",");
  useEffect(() => {
    const ids = scope.split(",").filter(Boolean) as AgentProviderId[];
    const refreshVisible = () => {
      if (document.visibilityState !== "hidden") for (const provider of ids) void refresh(provider);
    };
    refreshVisible();
    document.addEventListener("visibilitychange", refreshVisible);
    return () => document.removeEventListener("visibilitychange", refreshVisible);
  }, [scope, refresh]);
  if (!visible.length) return null;
  return <div className="sidebar-rail-usage">{visible.map((provider) => <UsageRing key={provider} provider={provider} />)}</div>;
}

function UsageRing({ provider }: { provider: AgentProviderId }) {
  const t = useTranslation();
  const usage = useAppStore((state) => state.usageByProvider[provider]);
  const loading = useAppStore((state) => !!state.usageLoading[provider]);
  const name = providerById(provider).name;
  const tightest = tightestUsageWindow(usage);
  const used = tightest?.usedPercent ?? null;
  const label = used == null
    ? t("Usage · {provider}", { provider: name })
    : t("sidebarUsage.ringLabel", { provider: name, percent: Math.round(used), window: t(usageWindowLabel(tightest!)) });
  const mark = modelBrandAsset(provider === "codex" ? "openai" : provider);
  return <Popover onOpenChange={(open) => { if (open) void useAppStore.getState().refreshProviderUsage(provider); }}>
    <PopoverTrigger asChild>
      <button type="button" className="sidebar-usage-ring" aria-label={label} title={label} data-unavailable={used == null || undefined}>
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r={RADIUS} className="sidebar-usage-track" />
          {used != null ? <circle cx="16" cy="16" r={RADIUS} className="sidebar-usage-arc" stroke={ringColor(provider, used)}
            strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - Math.min(100, Math.max(0, used)) / 100)} /> : null}
        </svg>
        <img src={mark.src} alt="" className={cn("sidebar-usage-mark", mark.monochrome && "brand-mark-monochrome")} />
      </button>
    </PopoverTrigger>
    <PopoverContent side="right" align="end" sideOffset={10} className="usage-popover scroll-thin max-h-[min(520px,80vh)] w-80 overflow-y-auto p-3" aria-label={t("Usage · {provider}", { provider: name })}>
      <ProviderUsagePanel provider={provider} name={name} usage={usage} loading={loading} barColor={(percent) => ringColor(provider, percent)} />
    </PopoverContent>
  </Popover>;
}

/** Memoized: the rail re-renders on hover; rings only follow their own usage. */
export const SidebarUsageRings = memo(SidebarUsageRingsView);
