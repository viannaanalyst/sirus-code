import { useMemo, useState } from "react";
import { Check, Pin } from "lucide-react";
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { HandoffIcon } from "@/components/icons/HandoffIcon";
import { ModelIcon } from "@/components/ModelIcon";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { IconButton } from "@/primitives/IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { Tooltip } from "@/primitives/Tooltip";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";
import { modelDisplayName } from "@/lib/model-registry";
import { PROVIDERS, providerById } from "@/lib/provider-registry";
import { isProviderEnabled } from "@/lib/settings";
import { useAppStore } from "@/store/app-store";
import type { AgentProviderId, Message, Session } from "@/client/types";

export function MessageTimestamp({ createdAt, className = "" }: { createdAt: string; className?: string }) {
  const locale = useAppStore((state) => state.settings.locale);
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
  return <time dateTime={createdAt} title={date.toLocaleString(locale)} className={`ui-caption tabular-nums ${className}`}>{time}</time>;
}

/** Hands the settled turn to another provider: same workspace, recap on first send. */
export function MessageActions({ message, session }: { message: Message; session: Session }) {
  const t = useTranslation();
  const handoffSession = useAppStore((state) => state.handoffSession);
  const settings = useAppStore((state) => state.settings);
  const installs = useAppStore((state) => state.agents);
  const catalogs = useAppStore((state) => state.modelsByProvider);
  const loadProviderModels = useAppStore((state) => state.loadProviderModels);
  const setPinned = useAppStore((state) => state.setMessagePinned);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [scope, setScope] = useState<AgentProviderId | null>(null);
  const [loading, setLoading] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const pinned = session.pinnedMessageIds?.includes(message.id) ?? false;
  const active = ["starting", "running", "waiting"].includes(session.status);
  const targets = useMemo(() => PROVIDERS.filter((definition) =>
    definition.id !== session.agent &&
    installs.some((item) => item.id === definition.id && item.installed) &&
    isProviderEnabled(settings, definition.id)
  ).map((definition) => definition.id), [installs, settings, session.agent]);
  const models = scope ? catalogs[scope]?.models ?? [] : [];

  const browse = (provider: AgentProviderId) => {
    if (scope === provider) return;
    setScope(provider);
    setLoading(true);
    void loadProviderModels(provider).finally(() => setLoading(false));
  };

  const loadScope = (provider: AgentProviderId) => {
    setScope(provider);
    setLoading(true);
    void loadProviderModels(provider).finally(() => setLoading(false));
  };

  const pick = (provider: AgentProviderId, model: string | null) => {
    if (handoffBusy) return;
    setHandoffBusy(true);
    void handoffSession(session.id, message.id, provider, model).finally(() => setHandoffBusy(false));
  };

  return <div className="mt-2 flex items-center gap-0.5 text-text-muted">
    <Tooltip label={t("Copy message")}><span className="inline-flex"><CopyButton value={message.content} label={t("Copy message")} iconOnly variant="plain" className="size-6 min-h-0 text-text-muted [&_svg]:size-[13px]" /></span></Tooltip>
    <Popover open={handoffOpen} onOpenChange={(next) => {
      setHandoffOpen(next);
      if (!next) return;
      const first = scope && targets.includes(scope) ? scope : targets[0];
      if (first) loadScope(first);
    }}>
      <Tooltip label={t(targets.length ? "Handoff" : "Install another provider to hand off")}>
        <PopoverTrigger asChild>
          <button type="button" disabled={active || handoffBusy || targets.length === 0} aria-label={t("Handoff")} aria-haspopup="menu" aria-expanded={handoffOpen}
            className="inline-flex size-6 min-h-0 shrink-0 items-center justify-center rounded-[7px] p-0 text-text-muted transition-colors duration-[var(--motion-fast)] hover:bg-background-3/80 hover:text-text-primary disabled:opacity-40">
            <HandoffIcon size={14} className="shrink-0" />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side="top" sideOffset={6} align="start" aria-label={t("Handoff")} className="w-[292px] p-0">
        <div className="flex h-[280px] max-h-[var(--radix-popover-content-available-height,280px)]">
          <div role="group" aria-label={t("providers.title")} className="scroll-thin flex w-10 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-border-subtle px-1 py-2">
            {targets.map((provider) => (
              <button key={provider} type="button" aria-label={providerById(provider).name} aria-pressed={scope === provider}
                className={cn("flex size-7 shrink-0 items-center justify-center rounded-[7px] text-text-muted transition-colors duration-[var(--motion-fast)] hover:bg-background-3 hover:text-text-primary", scope === provider && "bg-background-3 text-text-primary")}
                onPointerEnter={() => browse(provider)} onFocus={() => browse(provider)} onClick={() => browse(provider)}>
                <ProviderIcon id={provider} size={18} />
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto p-1.5" aria-busy={loading}>
            {!scope ? null : models.length > 0 ? models.map((model) => (
              <button key={model.id} type="button" disabled={handoffBusy} onClick={() => pick(scope, model.id)}
                className="flex min-h-9 w-full items-center gap-2 rounded-[8px] px-2 py-2 text-left hover:bg-background-3 disabled:opacity-40">
                <ModelIcon modelId={model.id} provider={scope} size={16} />
                <span className="min-w-0 flex-1 truncate ui-control text-text-primary">{modelDisplayName(scope, model.displayName, models.map((entry) => entry.displayName)).replace(/^Claude\s+/i, "")}</span>
                {session.model === model.id && session.agent === scope ? <Check size={13} aria-hidden="true" className="shrink-0 text-text-secondary" /> : null}
              </button>
            )) : (
              <div className="px-2 py-3 ui-description text-text-muted" role="status">
                {loading ? <p>{t("models.loading")}</p> : <button type="button" disabled={handoffBusy} onClick={() => pick(scope, null)}
                  className="flex min-h-9 w-full items-center gap-2 rounded-[8px] px-1 text-left hover:bg-background-3 disabled:opacity-40">
                  <ProviderIcon id={scope} size={16} />
                  <span className="min-w-0 flex-1 truncate ui-control text-text-primary">{t("Use provider default")}</span>
                </button>}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
    <IconButton label={t(pinned ? "Unpin message" : "Pin message")} aria-pressed={pinned} disabled={pinBusy} onClick={() => {
      setPinBusy(true);
      void setPinned(session.id, message.id, !pinned).finally(() => setPinBusy(false));
    }} className={`size-6 min-h-0 rounded-[7px] p-0 ${pinned ? "text-accent" : "text-text-muted"}`}><Pin aria-hidden="true" size={13} strokeWidth={1.6} fill={pinned ? "currentColor" : "none"} /></IconButton>
    <MessageTimestamp createdAt={message.createdAt} className="ml-1" />
  </div>;
}
