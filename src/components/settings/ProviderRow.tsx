import { useState } from "react";
import { client } from "@/client";
import type { AgentInstall } from "@/client/types";
import { Check, ChevronDown, FolderOpen, RotateCcw } from "@/components/icons/phosphor";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { translate } from "@/i18n";
import { formatUnknownError } from "@/lib/format-error";
import { executableChoices, withProviderPath } from "@/lib/provider-executables";
import type { ProviderDefinition } from "@/lib/providers";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/primitives/Dropdown";
import { Switch } from "@/primitives/Switch";
import { useAppStore } from "@/store/app-store";

export function ProviderRow({
  definition,
  install,
  enabled,
  onEnabledChange,
}: {
  definition: ProviderDefinition;
  install: AgentInstall | undefined;
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
}) {
  const locale = useAppStore((state) => state.settings.locale);
  const override = useAppStore((state) => state.settings.providerPaths[definition.id]);
  const t = (key: string, values?: Record<string, string>) => translate(locale, key, values);
  const installed = Boolean(install?.installed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices = executableChoices(install, override);
  // MonoCode #407: pick which install runs, persisted as the provider path override.
  const choose = async (path: string | null) => {
    setBusy(true); setError(null);
    try {
      const store = useAppStore.getState();
      await store.saveSettings(withProviderPath(store.settings, definition.id, path));
      await useAppStore.getState().refreshAgents();
    } finally { setBusy(false); }
  };
  const chooseFile = async () => {
    setError(null);
    try {
      const path = await client.pickExecutable();
      if (!path) return;
      const probe = await client.probeProvider(definition.id, path);
      if (!probe.ok) { setError(t("providers.executableFailed", { message: probe.message })); return; }
      await choose(path);
    } catch (reason) { setError(formatUnknownError(reason)); }
  };
  return (
    <div className="settings-row flex w-full items-center gap-3 border-b border-border-subtle py-3 last:border-b-0">
      <ProviderIcon id={definition.id} size={20} />
      <div className="min-w-0 flex-1">
        <p className="ui-control font-medium text-text-primary">{definition.name}</p>
        <p className="mt-0.5 ui-caption text-text-muted">
          {installed
            ? `${t("providers.installed")}${install?.version ? ` · ${install.version}` : ""}`
            : override ? t("providers.executableMissing") : t("providers.notDetected")}
        </p>
        {install?.path || choices.length ? <Dropdown>
          <DropdownTrigger asChild>
            <button type="button" disabled={busy} className="provider-executable mt-1 inline-flex max-w-full items-center gap-1 ui-caption text-text-secondary disabled:opacity-50" aria-label={t("providers.executableLabel", { name: definition.name })}>
              <span className="min-w-0 truncate font-mono" title={install?.path ?? undefined}>{install?.path ?? t("providers.executableNone")}</span>
              {override ? <span className="provider-executable-badge">{t("providers.executableCustom")}</span> : null}
              <ChevronDown size={11} aria-hidden="true" className="shrink-0" />
            </button>
          </DropdownTrigger>
          <DropdownContent align="start" side="bottom" className="max-w-[min(520px,calc(100vw-40px))] p-1">
            <p className="px-2 pb-1 pt-1 ui-caption text-text-muted">{t("providers.executableHint")}</p>
            {choices.map((choice) => <DropdownItem key={choice.path} onSelect={() => { if (!choice.current) void choose(choice.path); }}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1"><span className="block truncate font-mono ui-caption text-text-primary">{choice.path}</span><span className="block ui-caption text-text-muted">{choice.version ?? t("providers.executableNoVersion")}</span></span>
                {choice.current ? <Check size={13} aria-hidden="true" className="shrink-0" /> : <span className="w-[13px] shrink-0" />}
              </span>
            </DropdownItem>)}
            {choices.length ? <DropdownSeparator /> : null}
            <DropdownItem icon={<FolderOpen size={14} />} onSelect={() => void chooseFile()}>{t("providers.executableChoose")}</DropdownItem>
            {override ? <DropdownItem icon={<RotateCcw size={14} />} onSelect={() => void choose(null)}>{t("providers.executableAutomatic")}</DropdownItem> : null}
          </DropdownContent>
        </Dropdown> : <button type="button" disabled={busy} className="mt-1 ui-caption text-text-secondary underline-offset-2 hover:underline disabled:opacity-50" onClick={() => void chooseFile()}>{t("providers.executableChoose")}</button>}
        {error ? <p role="alert" className="mt-1 ui-caption text-danger">{error}</p> : null}
      </div>
      <Switch checked={enabled} onChange={onEnabledChange} label={`${t("providers.enable")} · ${definition.name}`} />
    </div>
  );
}
