import { useState } from "react";
import { Check, OctagonX, Plus, RefreshCw, Trash2 } from "@/components/icons/phosphor";
import { client } from "@/client";
import type { AgentInstall, AppSettings, McpProvider, McpServer } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { groupByName, isMcpProvider, maskedPairs, serverTarget } from "@/lib/mcp-servers";
import { providerById } from "@/lib/provider-registry";
import { useMcpCatalog } from "@/lib/use-mcp-catalog";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { IconButton } from "@/primitives/IconButton";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { Switch } from "@/primitives/Switch";
import { useAppStore } from "@/store/app-store";
import { McpServerDialog } from "./McpServerDialog";
import { ProviderIcon } from "./ProviderIcon";
import { SettingsGroup, SettingsRow, SettingsSection } from "./SettingsSection";
import "@/styles/general-settings.css";
import "@/styles/computer.css";

/** Settings → MCP servers (ADR-075) and the agent session tools switch (ADR-076). */
export function McpSettings({ settings, agents, onSave }: { settings: AppSettings; agents: AgentInstall[]; onSave: (next: AppSettings) => void }) {
  const t = useTranslation();
  const projectId = useAppStore(state => state.selectedProjectId);
  const { catalog, loading, error, refresh, replace } = useMcpCatalog(projectId);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<McpServer | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const installed = agents.filter(agent => agent.installed && isMcpProvider(agent.id)).map(agent => agent.id as McpProvider);
  const groups = groupByName(catalog?.servers ?? []);
  const remove = async () => {
    if (!removing) return;
    try {
      const result = await client.mcpAction({ type: "remove", projectId, provider: removing.provider, scope: removing.scope, name: removing.name });
      replace(result.catalog);
      setRemoveError(null);
    } catch (reason) {
      setRemoveError(formatUnknownError(reason));
      return false;
    }
  };
  return <SettingsSection title={t("mcp.title")} description={t("mcp.description")}
    headerAction={<div className="flex items-center gap-2">
      <IconButton label={t("mcp.refresh")} disabled={loading} onClick={() => void refresh()}><RefreshCw size={14} aria-hidden="true" /></IconButton>
      <InteractiveButton variant="secondary" glow={false} onClick={() => setAdding(true)}><Plus size={14} aria-hidden="true" />{t("mcp.add")}</InteractiveButton>
    </div>}>
    <div className="general-settings">
      <SettingsGroup title={t("mcp.agents.title")} card>
        <SettingsRow title={t("mcp.agents.enable")} description={t("mcp.agents.enableHelp")}>
          <Switch checked={settings.agentsManageSessions} onChange={value => onSave({ ...settings, agentsManageSessions: value })} label={t("mcp.agents.enable")} />
        </SettingsRow>
        {([[Check, "mcp.agents.can"], [OctagonX, "mcp.agents.cannot"]] as const).map(([Icon, key]) => <div key={key} className="computer-fact settings-row">
          <Icon size={16} aria-hidden="true" />
          <div><p className="ui-control font-medium text-text-primary">{t(key)}</p><p className="mt-0.5 ui-description text-text-muted">{t(`${key}Help`)}</p></div>
        </div>)}
      </SettingsGroup>

      <p className="mb-3 ui-caption text-text-muted">{catalog?.projectPath ? t("mcp.projectHint").replace("{path}", catalog.projectPath) : t("mcp.noProject")}</p>
      {error ? <p role="alert" className="mb-4 ui-control text-danger">{error}</p> : null}
      {loading && !catalog ? <p role="status" className="ui-control text-text-muted">{t("mcp.loading")}</p> : null}
      {catalog && !groups.length ? <div className="mb-8 rounded-[var(--radius-lg)] border border-border-subtle p-6"><p className="ui-control">{t("mcp.empty")}</p><p className="mt-1 ui-description text-text-muted">{t("mcp.emptyHelp")}</p></div> : null}
      {groups.length ? <SettingsGroup title={t("mcp.servers")} card>
        {groups.map(([name, rows]) => <div key={name} className="settings-row border-b border-border-subtle py-3 last:border-b-0">
          <p className="ui-control font-medium text-text-primary">{name}</p>
          <div className="mt-1.5 space-y-1.5">
            {rows.map(server => <div key={`${server.provider}:${server.scope}:${server.path}`} className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 ui-caption text-text-muted">
                  <span className="inline-flex items-center gap-1 text-text-secondary"><ProviderIcon id={server.provider} size={12} />{providerById(server.provider).name}</span>
                  <span>· {t(`mcp.scope.${server.scope}`)}</span>
                  <span>· {server.transport}</span>
                  {!server.enabled ? <span className="computer-chip">{t("mcp.off")}</span> : null}
                </div>
                <code className="selectable mt-0.5 block truncate ui-caption text-text-secondary" title={serverTarget(server)}>{serverTarget(server)}</code>
                {server.envKeys.length ? <p className="truncate ui-caption text-text-muted">{t("mcp.env")}: <code>{maskedPairs(server.envKeys)}</code></p> : null}
                {server.headerKeys.length ? <p className="truncate ui-caption text-text-muted">{t("mcp.headers")}: <code>{maskedPairs(server.headerKeys)}</code></p> : null}
                <p className="truncate ui-caption text-text-muted/70" title={server.path}>{server.path}</p>
              </div>
              <IconButton label={`${t("mcp.removeFrom").replace("{provider}", providerById(server.provider).name)} · ${name}`} onClick={() => { setRemoveError(null); setRemoving(server); }} className="size-6 min-h-0 p-0"><Trash2 size={13} aria-hidden="true" /></IconButton>
            </div>)}
          </div>
        </div>)}
      </SettingsGroup> : null}

      {catalog?.problems.length ? <SettingsGroup title={t("mcp.problems")} card>
        {catalog.problems.map(problem => <div key={problem.path} className="settings-row border-b border-border-subtle py-3 last:border-b-0">
          <p className="ui-control text-text-primary">{providerById(problem.provider as McpProvider).name}</p>
          <code className="selectable block break-all ui-caption text-text-muted">{problem.path}</code>
          <p className="mt-0.5 ui-caption text-danger">{problem.message}</p>
        </div>)}
      </SettingsGroup> : null}
    </div>
    <McpServerDialog open={adding} projectId={projectId} installed={installed} onClose={() => setAdding(false)} onDone={replace} />
    <ConfirmDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }}
      title={t("mcp.removeTitle").replace("{name}", removing?.name ?? "")}
      description={t("mcp.removeHelp").replace("{file}", removing?.path ?? "")}
      confirmLabel={t("mcp.remove")} onConfirm={remove}>
      {removeError ? <p role="alert" className="ui-caption text-danger">{removeError}</p> : null}
    </ConfirmDialog>
  </SettingsSection>;
}
