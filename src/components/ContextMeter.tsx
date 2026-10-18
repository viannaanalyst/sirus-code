import { useState } from "react";
import type { Session } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";
import { COMPACTING_PROVIDERS } from "@/lib/compact-before-send";
import { contextRing, formatTokens } from "@/lib/context-meter";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { useAppStore } from "@/store/app-store";
import "@/styles/context-meter.css";

/**
 * How much of the model's context window the conversation occupies, as the
 * provider last reported it (ADR-057). Hidden until both numbers are known.
 */
export function ContextMeter({ session }: { session: Session | null }) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const usage = session?.contextUsage;
  if (!session || !usage?.window) return null;
  // A reported window with nothing used yet still shows the ring, empty.
  const { ratio, percent, level, arc } = contextRing(usage.used, usage.window);
  const active = ["starting", "running", "waiting"].includes(session.status);
  const canCompact = COMPACTING_PROVIDERS.has(session.agent) && Boolean(session.nativeThread);
  const radius = 5.5, circumference = 2 * Math.PI * radius;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" className="context-meter" data-level={level} aria-label={t("context.label", { percent })}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
          {arc ? <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            strokeDasharray={`${circumference * ratio} ${circumference}`} transform="rotate(-90 8 8)" /> : null}
        </svg>
      </button>
    </PopoverTrigger>
    <PopoverContent side="top" align="end" sideOffset={8} className="flex min-w-0 items-center gap-3.5 py-2 pr-2 pl-3">
      <div className="min-w-0">
        <p className="ui-control font-medium text-text-primary">{t("context.used", { percent })}</p>
        <p className="ui-caption tabular-nums text-text-muted">{t("context.tokens", { used: formatTokens(usage.used), window: formatTokens(usage.window) })}</p>
      </div>
      {canCompact ? <button type="button" className={cn("context-meter-compact ui-caption", level !== "normal" && "context-meter-compact-strong")} disabled={active}
        title={active ? t("context.wait") : undefined}
        onClick={() => { setOpen(false); void useAppStore.getState().sendPrompt("/compact", undefined, session.id); }}>{t("context.compact")}</button> : null}
    </PopoverContent>
  </Popover>;
}
