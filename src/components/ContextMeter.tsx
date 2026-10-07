import { useState } from "react";
import type { Session } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";
import { COMPACTING_PROVIDERS } from "@/lib/compact-before-send";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { useAppStore } from "@/store/app-store";
import "@/styles/context-meter.css";


export function formatTokens(value: number) {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${value < 10_000 ? (value / 1000).toFixed(1).replace(/\.0$/, "") : Math.round(value / 1000)}K`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/**
 * How much of the model's context window the conversation occupies, as the
 * provider last reported it (ADR-057). Hidden until both numbers are known.
 */
export function ContextMeter({ session }: { session: Session | null }) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const usage = session?.contextUsage;
  if (!session || !usage?.window) return null;
  const ratio = Math.min(1, usage.used / usage.window);
  const percent = Math.round(ratio * 100);
  const level = ratio >= 0.9 ? "danger" : ratio >= 0.75 ? "warning" : "normal";
  const active = ["starting", "running", "waiting"].includes(session.status);
  const canCompact = COMPACTING_PROVIDERS.has(session.agent) && Boolean(session.nativeThread);
  const radius = 5.5, circumference = 2 * Math.PI * radius;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" className="context-meter" data-level={level} aria-label={t("context.label", { percent })}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
          <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            strokeDasharray={`${circumference * ratio} ${circumference}`} transform="rotate(-90 8 8)" />
        </svg>
      </button>
    </PopoverTrigger>
    <PopoverContent side="top" align="end" sideOffset={8} className="w-[248px] p-3">
      <p className="ui-control font-medium text-text-primary">{t("context.used", { percent })}</p>
      <p className="mt-0.5 ui-caption tabular-nums text-text-muted">{t("context.tokens", { used: formatTokens(usage.used), window: formatTokens(usage.window) })}</p>
      <p className="mt-2 ui-caption text-text-muted">{t(canCompact ? "context.help" : "context.helpNoCompact")}</p>
      {canCompact ? <button type="button" className={cn("context-meter-compact ui-control", level !== "normal" && "context-meter-compact-strong")} disabled={active}
        title={active ? t("context.wait") : undefined}
        onClick={() => { setOpen(false); void useAppStore.getState().sendPrompt("/compact", undefined, session.id); }}>{t("context.compact")}</button> : null}
    </PopoverContent>
  </Popover>;
}
