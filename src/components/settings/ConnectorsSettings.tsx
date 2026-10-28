import { useCallback, useEffect, useMemo, useState } from "react";
import { client } from "@/client";
import type { AgentInstall, AgentProviderId, AppSettings, Connector, ConnectorAuth, ConnectorStatus } from "@/client/types";
import { Checkbox } from "@/components/arc/checkbox/checkbox";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Input } from "@/components/arc/input/input";
import { LogIn, LogOut, MoreHorizontal, Pencil, Plus, PowerIcon, Search, Trash2 } from "@/components/icons";
import { useTranslation } from "@/i18n/use-translation";
import { BRAND_MARKS } from "@/lib/connector-marks";
import { CONNECTOR_AGENTS, CONNECTOR_CATALOG, CONNECTOR_CATEGORIES, catalogEntry, supabaseDetails, supabaseUrl, validConnectorUrl, type CatalogConnector } from "@/lib/connectors-catalog";
import { formatUnknownError } from "@/lib/format-error";
import { providerById } from "@/lib/provider-registry";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/primitives/Dropdown";
import { IconButton } from "@/primitives/IconButton";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { SegmentedControl } from "@/primitives/SegmentedControl";
import { Switch } from "@/primitives/Switch";
import { useAppStore } from "@/store/app-store";
import { ProviderIcon } from "./ProviderIcon";
import "@/styles/connectors.css";

/** A brand's official mark: the Simple Icons path in its color, or the image from its site. */
export function ConnectorLogo({ catalogId, name, size = 28 }: { catalogId?: string; name: string; size?: number }) {
  const entry = catalogEntry(catalogId);
  const mark = catalogId ? BRAND_MARKS[catalogId] : undefined;
  if (entry?.image) return <span className="connector-logo" style={{ width: size, height: size }}><img src={entry.image} alt="" width={size - 8} height={size - 8} /></span>;
  if (mark) {
    // Near-black marks (Notion, Vercel, GitHub…) follow the text color so they read on dark themes.
    const value = parseInt(mark.color.slice(1), 16);
    const light = 0.2126 * (value >> 16) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255);
    return <span className="connector-logo" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size - 10} height={size - 10} aria-hidden="true"><path d={mark.path} fill={light < 60 ? "currentColor" : mark.color} /></svg>
    </span>;
  }
  return <span className="connector-logo connector-logo-letter" style={{ width: size, height: size }}>{name.trim().charAt(0).toUpperCase() || "·"}</span>;
}

type Draft = { connector: Connector | null; entry: CatalogConnector | null };

/** Settings → Connectors (ADR-137): the catalog, the connected ones and the connect dialog. */
export function ConnectorsSettings({ settings, agents, onSave }: { settings: AppSettings; agents: AgentInstall[]; onSave: (next: AppSettings) => void }) {
  const t = useTranslation();
  const projects = useAppStore((state) => state.projects);
  const currentProjectId = useAppStore((state) => state.selectedProjectId);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "project">("all");
  const [statuses, setStatuses] = useState<Record<string, ConnectorStatus["state"]>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<Connector | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const connectors = settings.connectors;
  const installed = useMemo(() => CONNECTOR_AGENTS.filter((id) => agents.some((agent) => agent.id === id && agent.installed)), [agents]);

  const apply = (list: ConnectorStatus[]) => setStatuses(Object.fromEntries(list.map((item) => [item.id, item.state])));
  const refresh = useCallback(() => void client.connectorAction({ type: "status" }).then(apply).catch(() => undefined), []);
  useEffect(refresh, [refresh, connectors.length]);

  const save = (next: Connector[]) => onSave({ ...settings, connectors: next });
  const signIn = async (connector: Connector) => {
    setRowError(null);
    setSigningIn(connector.id);
    try { apply(await client.connectorAction({ type: "signIn", id: connector.id })); }
    catch (error) { setRowError(`${connector.name}: ${formatUnknownError(error)}`); }
    finally { setSigningIn(null); }
  };
  const signOut = async (connector: Connector) => {
    try { apply(await client.connectorAction({ type: "signOut", id: connector.id })); }
    catch (error) { setRowError(formatUnknownError(error)); }
  };
  const remove = async () => {
    if (!removing) return;
    await client.connectorAction({ type: "signOut", id: removing.id }).catch(() => undefined);
    save(connectors.filter((item) => item.id !== removing.id));
  };

  const needle = query.trim().toLocaleLowerCase();
  const describe = (entry: CatalogConnector) => t(`connectors.desc.${entry.id}`);
  const matches = (name: string, description: string) => !needle || name.toLocaleLowerCase().includes(needle) || description.toLocaleLowerCase().includes(needle);
  const projectName = (id: string | undefined) => id ? projects.find((project) => project.id === id)?.name ?? id.slice(0, 8) : null;
  const shownConnected = connectors.filter((connector) => {
    const entry = catalogEntry(connector.catalogId);
    if (scope === "project" && connector.projectId && connector.projectId !== currentProjectId) return false;
    return matches(connector.name, entry ? describe(entry) : connector.url);
  });
  const currentName = projectName(currentProjectId ?? undefined);

  return <div className="connectors">
    <div className="connectors-bar">
      <label className="connectors-search">
        <Search size={14} aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("connectors.search")} aria-label={t("connectors.search")} />
      </label>
      <InteractiveButton variant="primary" onClick={() => setDraft({ connector: null, entry: null })}><Plus size={14} aria-hidden="true" />{t("connectors.addCustom")}</InteractiveButton>
    </div>
    {currentName ? <div className="connectors-scope" role="group" aria-label={t("connectors.title")}>
      <button type="button" data-on={scope === "all" || undefined} onClick={() => setScope("all")}>{t("connectors.filter.all")}</button>
      <button type="button" data-on={scope === "project" || undefined} onClick={() => setScope("project")}>{t("connectors.filter.project", { name: currentName })}</button>
    </div> : null}
    {rowError ? <p role="alert" className="connectors-error">{rowError}</p> : null}

    {shownConnected.length ? <section>
      <h3 className="connectors-heading">{t("connectors.connected")}</h3>
      <div className="connectors-grid">
        {shownConnected.map((connector) => {
          const entry = catalogEntry(connector.catalogId);
          const state = statuses[connector.id];
          const supabase = entry?.supabase ? supabaseDetails(connector.url) : null;
          const detail = supabase?.projectRef ? `${supabase.projectRef}${supabase.readOnly ? ` · ${t("connectors.dialog.readOnly").toLocaleLowerCase()}` : ""}` : entry ? describe(entry) : new URL(connector.url).host;
          const needsSignIn = connector.auth !== "none" && (state === "signedOut" || state === "expired");
          return <div key={connector.id} className="connector-item" data-off={!connector.enabled || undefined}>
            <ConnectorLogo catalogId={connector.catalogId} name={connector.name} />
            <span className="connector-body">
              <span className="connector-name">
                <span className="truncate">{connector.name}</span>
                <span className="connector-tag" data-project={connector.projectId ? "" : undefined}>{projectName(connector.projectId) ?? t("connectors.allProjects")}</span>
                {!connector.enabled ? <span className="connector-tag">{t("connectors.off")}</span> : null}
                {connector.auth !== "none" && state === "connected" ? <span className="connector-signed-in"><i aria-hidden="true" />{t("connectors.state.connected")}</span> : null}
              </span>
              <span className="connector-desc">{detail}</span>
            </span>
            {needsSignIn && connector.auth === "oauth" ? <InteractiveButton variant="secondary" glow={false} loading={signingIn === connector.id} onClick={() => void signIn(connector)}>
              {t(state === "expired" ? "connectors.signInAgain" : "connectors.signIn")}
            </InteractiveButton> : needsSignIn ? <InteractiveButton variant="secondary" glow={false} onClick={() => setDraft({ connector, entry: entry ?? null })}>{t("connectors.signIn")}</InteractiveButton> : null}
            <Dropdown>
              <DropdownTrigger asChild><IconButton label={t("connectors.more", { name: connector.name })} tooltip={false} className="connector-action"><MoreHorizontal size={15} aria-hidden="true" /></IconButton></DropdownTrigger>
              <DropdownContent align="end">
                {connector.auth === "oauth" ? <DropdownItem icon={<LogIn size={14} />} onSelect={() => void signIn(connector)}>{t(state === "connected" ? "connectors.signInAgain" : "connectors.signIn")}</DropdownItem> : null}
                {connector.auth !== "none" && state === "connected" ? <DropdownItem icon={<LogOut size={14} />} onSelect={() => void signOut(connector)}>{t("connectors.signOut")}</DropdownItem> : null}
                <DropdownItem icon={<Pencil size={14} />} onSelect={() => setDraft({ connector, entry: entry ?? null })}>{t("connectors.edit")}</DropdownItem>
                <DropdownItem icon={<PowerIcon size={14} />} onSelect={() => save(connectors.map((item) => item.id === connector.id ? { ...item, enabled: !item.enabled } : item))}>{t(connector.enabled ? "connectors.turnOff" : "connectors.turnOn")}</DropdownItem>
                <DropdownSeparator />
                <DropdownItem destructive icon={<Trash2 size={14} />} onSelect={() => setRemoving(connector)}>{t("connectors.remove")}</DropdownItem>
              </DropdownContent>
            </Dropdown>
          </div>;
        })}
      </div>
    </section> : null}

    {CONNECTOR_CATEGORIES.map((category) => {
      const items = CONNECTOR_CATALOG.filter((entry) => entry.category === category && matches(entry.name, describe(entry)));
      if (!items.length) return null;
      return <section key={category}>
        <h3 className="connectors-heading">{t(`connectors.category.${category}`)}</h3>
        <div className="connectors-grid">
          {items.map((entry) => <div key={entry.id} className="connector-item">
            <ConnectorLogo catalogId={entry.id} name={entry.name} />
            <span className="connector-body"><span className="connector-name"><span className="truncate">{entry.name}</span></span><span className="connector-desc">{describe(entry)}</span></span>
            <IconButton label={t("connectors.connect", { name: entry.name })} className="connector-action" onClick={() => setDraft({ connector: null, entry })}><Plus size={15} aria-hidden="true" /></IconButton>
          </div>)}
        </div>
      </section>;
    })}
    {needle && !shownConnected.length && !CONNECTOR_CATALOG.some((entry) => matches(entry.name, describe(entry))) ? <p className="connectors-foot">{t("connectors.none")}</p> : null}
    <p className="connectors-foot">{t("connectors.foot")}</p>

    <ConnectorDialog draft={draft} installed={installed} projects={projects.map((project) => ({ id: project.id, name: project.name }))} defaultProjectId={currentProjectId}
      onClose={() => setDraft(null)}
      onSave={async (connector, token) => {
        const exists = connectors.some((item) => item.id === connector.id);
        const next = exists ? connectors.map((item) => item.id === connector.id ? connector : item) : [...connectors, connector];
        // Saved natively first: sign-in reads the connector from the saved settings.
        await useAppStore.getState().saveSettings({ ...useAppStore.getState().settings, connectors: next });
        if (connector.auth === "token" && token) apply(await client.connectorAction({ type: "setToken", id: connector.id, token }));
        if (connector.auth === "oauth" && (!exists || statuses[connector.id] !== "connected")) {
          setSigningIn(connector.id);
          try { apply(await client.connectorAction({ type: "signIn", id: connector.id })); }
          finally { setSigningIn(null); }
        }
        refresh();
      }} />
    <ConfirmDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }}
      title={t("connectors.removeTitle", { name: removing?.name ?? "" })} description={t("connectors.removeHelp")}
      confirmLabel={t("connectors.remove")} onConfirm={remove} />
  </div>;
}

function ConnectorDialog({ draft, installed, projects, defaultProjectId, onClose, onSave }: {
  draft: Draft | null;
  installed: AgentProviderId[];
  projects: { id: string; name: string }[];
  defaultProjectId: string | null;
  onClose: () => void;
  onSave: (connector: Connector, token: string) => Promise<void>;
}) {
  const t = useTranslation();
  const open = draft !== null;
  const entry = draft?.entry ?? null;
  const editing = draft?.connector ?? null;
  // One id per opened dialog: a retry after a failed sign-in updates the connector it saved, not a second one.
  const newId = useMemo(() => (draft ? crypto.randomUUID() : ""), [draft]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [auth, setAuth] = useState<ConnectorAuth>("oauth");
  const [token, setToken] = useState("");
  const [where, setWhere] = useState<"project" | "all">("project");
  const [projectId, setProjectId] = useState("");
  const [projectRef, setProjectRef] = useState("");
  const [readOnly, setReadOnly] = useState(true);
  const [chosen, setChosen] = useState<AgentProviderId[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Each opening starts from the connector being edited, or the catalog entry's defaults.
  const [opened, setOpened] = useState<Draft | null>(null);
  if (draft !== opened) {
    setOpened(draft);
    if (draft) {
      const base = draft.connector;
      const supabase = draft.entry?.supabase ? supabaseDetails(base?.url ?? "") : null;
      setName(base?.name ?? draft.entry?.name ?? "");
      setUrl(base?.url ?? draft.entry?.url ?? "");
      setAuth(base?.auth ?? draft.entry?.auth ?? "oauth");
      setToken("");
      setWhere(base ? (base.projectId ? "project" : "all") : defaultProjectId ? "project" : "all");
      setProjectId(base?.projectId ?? defaultProjectId ?? projects[0]?.id ?? "");
      setProjectRef(supabase?.projectRef ?? "");
      setReadOnly(base ? Boolean(supabase?.readOnly) : true);
      setChosen(base?.agents ?? (installed.length ? installed : ["claude"]));
      setBusy(false);
      setError(null);
    }
  }
  const finalUrl = entry?.supabase ? supabaseUrl(entry.url, projectRef, readOnly) : url.trim();
  const problem = !name.trim() ? "connectors.dialog.name"
    : !validConnectorUrl(finalUrl) ? "connectors.dialog.invalidUrl"
    : !chosen.length ? "connectors.dialog.needAgent"
    : where === "project" && !projectId ? "connectors.dialog.needProject"
    : auth === "token" && !token.trim() && !(editing && editing.auth === "token") ? "connectors.dialog.needToken"
    : null;
  const submit = async () => {
    if (problem || busy) return;
    setBusy(true);
    setError(null);
    const connector: Connector = {
      id: editing?.id ?? newId,
      ...(entry ? { catalogId: entry.id } : editing?.catalogId ? { catalogId: editing.catalogId } : {}),
      name: name.trim(),
      url: finalUrl,
      ...(where === "project" && projectId ? { projectId } : {}),
      agents: chosen,
      enabled: editing?.enabled ?? true,
      auth,
    };
    try {
      await onSave(connector, token.trim());
      onClose();
    } catch (reason) {
      setError(formatUnknownError(reason));
    } finally {
      setBusy(false);
    }
  };
  const help = !entry && !editing ? "connectors.dialog.customHelp" : auth === "oauth" ? "connectors.dialog.oauthHelp" : auth === "token" ? "connectors.dialog.tokenHelp" : "connectors.dialog.openHelp";
  const title = editing ? editing.name : entry ? t("connectors.connect", { name: entry.name }) : t("connectors.dialog.customTitle");
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
    <DialogContent title={title} description={t(help)} className="w-[min(500px,calc(100vw-32px))]">
      <form className="connector-dialog mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {entry ? <div className="connector-dialog-brand"><ConnectorLogo catalogId={entry.id} name={entry.name} size={36} /><span>{t(`connectors.desc.${entry.id}`)}</span></div> : null}
        {!entry ? <>
          <Input label={t("connectors.dialog.name")} autoFocus={!editing} maxLength={64} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} />
          {!editing?.catalogId ? <Input label={t("connectors.dialog.url")} spellCheck={false} placeholder="https://mcp.example.com/mcp" value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy} /> : null}
          {!editing?.catalogId ? <SegmentedControl label={t("connectors.dialog.auth")} value={auth} onChange={setAuth} disabled={busy}
            options={[{ value: "oauth", label: t("connectors.dialog.auth.oauth") }, { value: "token", label: t("connectors.dialog.auth.token") }, { value: "none", label: t("connectors.dialog.auth.none") }]} /> : null}
        </> : null}
        {auth === "token" ? <Input label={t("connectors.dialog.token")} type="password" spellCheck={false} autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} disabled={busy}
          description={editing?.auth === "token" ? t("connectors.dialog.tokenKeep") : undefined} /> : null}
        <div className="space-y-2">
          <SegmentedControl label={t("connectors.dialog.where")} value={where} onChange={setWhere} disabled={busy || !projects.length}
            options={[{ value: "project", label: t("connectors.dialog.thisProject") }, { value: "all", label: t("connectors.dialog.everyProject") }]} />
          {where === "project" ? <label className="connector-select">
            <span>{t("connectors.dialog.project")}</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={busy}>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label> : null}
        </div>
        {entry?.supabase || (editing && catalogEntry(editing.catalogId)?.supabase) ? <>
          <Input label={t("connectors.dialog.projectRef")} description={t("connectors.dialog.projectRefHelp")} spellCheck={false} placeholder="abcdefghijklmnopqrst" value={projectRef} onChange={(event) => setProjectRef(event.target.value.trim())} disabled={busy} />
          <div className="connector-toggle">
            <span><span className="ui-control text-text-primary">{t("connectors.dialog.readOnly")}</span><span className="block ui-caption text-text-muted">{t("connectors.dialog.readOnlyHelp")}</span></span>
            <Switch checked={readOnly} onChange={setReadOnly} label={t("connectors.dialog.readOnly")} />
          </div>
        </> : null}
        <fieldset>
          <legend className="mb-1.5 ui-control font-medium text-text-primary">{t("connectors.dialog.agents")}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {CONNECTOR_AGENTS.map((id) => <span key={id} className="inline-flex items-center gap-1.5"><ProviderIcon id={id} size={14} /><Checkbox label={providerById(id).name} checked={chosen.includes(id)} disabled={busy}
              onCheckedChange={(value) => setChosen(value === true ? [...chosen, id] : chosen.filter((item) => item !== id))} /></span>)}
          </div>
        </fieldset>
        {busy && auth === "oauth" ? <p role="status" className="ui-caption text-text-muted">{t("connectors.signingIn")}</p> : null}
        {error ? <p role="alert" className="ui-caption text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <InteractiveButton variant="ghost" disabled={busy} onClick={onClose}>{t("common.cancel")}</InteractiveButton>
          <InteractiveButton type="submit" variant="primary" loading={busy} disabled={Boolean(problem)}>{t(editing ? "connectors.dialog.save" : "connectors.dialog.connect")}</InteractiveButton>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
