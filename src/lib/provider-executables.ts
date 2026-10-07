import type { AgentInstall, AgentProviderId, AppSettings } from "@/client/types";

export interface ExecutableChoice { path: string; version: string | null; current: boolean }

/**
 * Installs offered in Settings → Providers (MonoCode #407): every one detection found, plus a
 * chosen file outside those folders. The current one is the override, else the automatic pick.
 */
export function executableChoices(install: AgentInstall | undefined, override: string | undefined): ExecutableChoice[] {
  const active = override ?? install?.path ?? null;
  const rows = (install?.candidates ?? []).map(({ path, version }) => ({ path, version, current: path === active || (!override && path === install?.path) }));
  if (override && !rows.some((row) => row.path === override)) rows.unshift({ path: override, version: install?.installed ? install.version : null, current: true });
  return rows;
}

/** `null` returns the provider to automatic detection. */
export function withProviderPath(settings: AppSettings, id: AgentProviderId, path: string | null): AppSettings {
  const providerPaths = { ...settings.providerPaths };
  if (path) providerPaths[id] = path; else delete providerPaths[id];
  return { ...settings, providerPaths };
}
