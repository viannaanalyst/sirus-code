import type { AgentInstall } from "@/client/types";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { translate } from "@/i18n";
import type { ProviderDefinition } from "@/lib/providers";
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
  const t = (key: string) => translate(locale, key);
  const installed = Boolean(install?.installed);
  return (
    <div className="settings-row flex w-full items-center gap-3 border-b border-border-subtle py-3 last:border-b-0">
      <ProviderIcon id={definition.id} size={20} />
      <div className="min-w-0 flex-1">
        <p className="ui-control font-medium text-text-primary">{definition.name}</p>
        <p className="mt-0.5 ui-caption text-text-muted">
          {installed
            ? `${t("providers.installed")}${install?.version ? ` · ${install.version}` : ""}`
            : t("providers.notDetected")}
        </p>
      </div>
      <Switch checked={enabled} onChange={onEnabledChange} label={`${t("providers.enable")} · ${definition.name}`} />
    </div>
  );
}
