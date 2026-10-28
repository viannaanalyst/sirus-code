import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Project, Session } from "@/client/types";
import { Laptop, LoaderCircle, Plus, Server, WifiOff } from "@/components/icons/phosphor";
import { normalizePairingCode } from "@/client/remote-pairing";
import { HOME_ENVIRONMENT, environmentLabel, mergeEnvironments, summaryWithPending, unreachableEnvironments, type Environment, type EnvironmentFilter, type MergedHome } from "@/lib/environments";
import { formatUnknownError } from "@/lib/format-error";
import { selectSessionsMeta, useAppStore } from "@/store/app-store";
import { EnvironmentError, environmentOffline, useEnvironments } from "@/store/environments-store";
import type { MobileNavigation } from "./MobileApp";
import { MobileDialog } from "./MobileDialog";
import { MobileSessionItem } from "./MobileSessionRow";
import { Row } from "./MobileSettingsParts";
import { usePhoneTranslation as useTranslation } from "./use-phone-host";
import "@/styles/mobile-environments.css";

/**
 * One phone app, several computers (ADR-132): the merged Home data, the small marker on rows
 * of other computers, opening a conversation on any of them, and Settings → Connections.
 */

type Translate = ReturnType<typeof useTranslation>;

/** The person's name for a computer, in the phone's language. */
export function useEnvironmentLabel(): (environment: Environment | undefined) => string {
  const t = useTranslation();
  return (environment) => environment ? environmentLabel(environment, t("environments.computer")) : "";
}

export interface MergedHomeData extends MergedHome {
  /** More than one computer is known: rows show which one they are on. */
  multiple: boolean;
  /** The computer whose data the main store holds. */
  storeId: string;
}

/**
 * The Home's conversations and projects across every computer: the active one live from the
 * store (or its cached summary while it cannot be reached), the others from their summaries.
 * With one computer this is the store's data unchanged.
 */
export function useMergedHome(): MergedHomeData {
  const sessions = useAppStore(selectSessionsMeta);
  const projects = useAppStore((state) => state.projects);
  const pinned = useAppStore((state) => state.settings.pinnedSessionIds);
  const { environments, storeId, summaries, pending } = useEnvironments(useShallow((state) => ({ environments: state.environments, storeId: state.storeId, summaries: state.summaries, pending: state.pending })));
  return useMemo(() => {
    const paired = environments.filter((item) => item.token);
    if (paired.length < 2) return { sessions, projects, pinnedSessionIds: pinned, environmentOf: new Map(), multiple: false, storeId };
    const cached = summaries[storeId];
    const live = sessions.length || projects.length || !cached
      ? { id: storeId, sessions, projects, pinnedSessionIds: pinned }
      : { id: storeId, ...cached };
    // Changes waiting for a computer already show in its rows (ADR-132 addendum).
    const others = paired.filter((item) => item.id !== storeId && summaries[item.id])
      .map((item) => ({ id: item.id, ...summaryWithPending(summaries[item.id], pending.filter((action) => action.environmentId === item.id)) }));
    return { ...mergeEnvironments(live, others), multiple: true, storeId };
  }, [sessions, projects, pinned, environments, storeId, summaries, pending]);
}

/** Opens a conversation or a new one on whichever computer it belongs to, switching first. */
export function useOpenOnEnvironment(navigation: MobileNavigation) {
  const t = useTranslation();
  const label = useEnvironmentLabel();
  return (environmentId: string | undefined, screen: Parameters<MobileNavigation["open"]>[0], how: "open" | "replace" = "open") => {
    const environments = useEnvironments.getState();
    if (!environmentId || environmentId === environments.storeId) { navigation[how](screen); return; }
    const environment = environments.environments.find((item) => item.id === environmentId);
    if (environmentOffline(environments.connection[environmentId])) {
      useAppStore.setState({ error: t("environments.unavailable", { name: label(environment) }) });
      return;
    }
    void environments.activate(environmentId).then((switched) => {
      if (switched) navigation[how](screen);
      else useAppStore.setState({ error: t("environments.unavailable", { name: label(environment) }) });
    });
  };
}

/** The small "which computer" marker on a row: an icon and the computer's name, dimmed offline. */
export function EnvironmentMarker({ environmentId }: { environmentId: string | undefined }) {
  const t = useTranslation();
  const label = useEnvironmentLabel();
  const environment = useEnvironments((state) => state.environments.find((item) => item.id === environmentId));
  const offline = useEnvironments((state) => environmentId ? environmentOffline(state.connection[environmentId]) : false);
  const switching = useEnvironments((state) => state.switchingTo === environmentId);
  if (!environment) return null;
  const Icon = environment.kind === "server" ? Server : Laptop;
  return <span className="mobile-env-marker" data-offline={offline || undefined}>
    {switching ? <LoaderCircle size={11} className="animate-spin" aria-hidden="true" /> : <Icon size={11} aria-hidden="true" />}
    <span>{label(environment)}</span>
    {offline ? <span className="sr-only">, {t("environments.offline")}</span> : null}
  </span>;
}

/**
 * A conversation on a computer that is not the active one: opened by switching, with the same
 * swipe and menu as any row, run on that computer. While that computer is out of reach the row
 * looks as usual and its actions wait on the phone (ADR-132 addendum).
 */
export function EnvironmentSessionRow({ session, project, environmentId, onOpen }: { session: Session; project: Project | undefined; environmentId: string; onOpen: () => void }) {
  return <MobileSessionItem session={session} project={project} arrange environmentId={environmentId} marker={<EnvironmentMarker environmentId={environmentId} />} onOpen={onOpen} />;
}

/** Home's top line while a computer is out of reach: "Reconnecting to sirus-vps…", a spinner while it tries. */
export function EnvironmentStatus() {
  const t = useTranslation();
  const label = useEnvironmentLabel();
  const { environments, connection } = useEnvironments(useShallow((state) => ({ environments: state.environments, connection: state.connection })));
  const paired = environments.filter((item) => item.token);
  const missing = paired.length > 1 ? unreachableEnvironments(paired, connection) : [];
  if (!missing.length) return null;
  return <div className="mobile-env-status" role="status">
    {missing.map(({ environment, connecting }) => <p key={environment.id} className="mobile-env-status-line">
      {connecting ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <WifiOff size={14} aria-hidden="true" />}
      <span>{t("environments.reconnecting", { name: label(environment) })}</span>
    </p>)}
  </div>;
}

/** All / one chip per computer above Snoozed; nothing with one computer. */
export function EnvironmentFilterBar({ value, onChange }: { value: EnvironmentFilter; onChange: (value: EnvironmentFilter) => void }) {
  const t = useTranslation();
  const label = useEnvironmentLabel();
  const environments = useEnvironments((state) => state.environments);
  const paired = environments.filter((item) => item.token);
  if (paired.length < 2) return null;
  return <div className="mobile-env-filter" role="group" aria-label={t("environments.filter")}>
    <button type="button" aria-pressed={value === "all"} onClick={() => onChange("all")}>{t("environments.filterAll")}</button>
    {paired.map((environment) => <button key={environment.id} type="button" aria-pressed={value === environment.id} onClick={() => onChange(environment.id)}>{label(environment)}</button>)}
  </div>;
}

function statusText(t: Translate, active: boolean, connection: string | undefined) {
  if (connection === "unauthorized") return t("environments.pairAgain");
  if (connection === "lost") return t("mobile.offline");
  if (connection === "open") return active ? t("environments.inUse") : t("mobile.online");
  return t("environments.connecting");
}

/** Settings → Connections: one row per computer, and "Add computer". */
export function EnvironmentRows() {
  const t = useTranslation();
  const label = useEnvironmentLabel();
  const { environments, activeId, connection } = useEnvironments(useShallow((state) => ({ environments: state.environments, activeId: state.activeId, connection: state.connection })));
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const shown = environments.filter((item) => item.token || item.id === HOME_ENVIRONMENT);
  return <>
    {shown.map((environment) => {
      const state = connection[environment.id];
      const online = state === "open" || (state !== "lost" && state !== "unauthorized" && environment.id === activeId);
      const Icon = environment.kind === "server" ? Server : Laptop;
      return <Row key={environment.id} icon={<Icon size={19} />} label={label(environment)}
        value={<span className="mobile-host" data-online={online || undefined}><span>{statusText(t, environment.id === activeId, state)}</span></span>}
        onClick={() => setEditing(environment.id)} />;
    })}
    <Row icon={<Plus size={19} />} label={t("environments.add")} onClick={() => setAdding(true)} />
    <EnvironmentDialog id={editing} onClose={() => setEditing(null)} />
    <AddComputerDialog open={adding} onClose={() => setAdding(false)} />
  </>;
}

function EnvironmentDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useTranslation();
  const label = useEnvironmentLabel();
  const environment = useEnvironments((state) => state.environments.find((item) => item.id === id));
  const activeId = useEnvironments((state) => state.activeId);
  const offline = useEnvironments((state) => id ? environmentOffline(state.connection[id]) : false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (environment && shownFor !== environment.id) { setShownFor(environment.id); setName(environment.label || label(environment)); }
  const close = () => { setShownFor(null); onClose(); };
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try { await action(); close(); } catch (error) { useAppStore.setState({ error: formatUnknownError(error) }); } finally { setBusy(false); }
  };
  const save = () => {
    if (!environment) return;
    const next = name.trim();
    useEnvironments.getState().rename(environment.id, next === label({ ...environment, label: "" }) ? "" : next);
    close();
  };
  return <MobileDialog open={!!environment} title={environment ? label(environment) : ""} onClose={close}>
    {environment ? <form className="mobile-env-dialog" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <p className="mobile-env-address">{environment.id === HOME_ENVIRONMENT ? t("environments.home") : environment.baseUrl.replace(/^https?:\/\//, "")}</p>
      <label className="mobile-env-field"><span>{t("environments.name")}</span>
        <input className="mobile-input mobile-env-input" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} enterKeyHint="done" />
      </label>
      {environment.id !== activeId ? <button type="button" className="mobile-dialog-button mobile-env-wide" disabled={busy || offline} onClick={() => void run(() => useEnvironments.getState().activate(environment.id))}>{t("environments.use")}</button> : null}
      {environment.id !== HOME_ENVIRONMENT ? <>
        <button type="button" className="mobile-dialog-button mobile-env-wide" data-tone="danger" disabled={busy} onClick={() => void run(() => useEnvironments.getState().forget(environment.id))}>{t("environments.forget")}</button>
        <p className="mobile-help">{t("environments.forgetHelp")}</p>
      </> : null}
      <div className="mobile-dialog-actions">
        <button type="button" className="mobile-dialog-button" onClick={close}>{t("common.cancel")}</button>
        <button type="submit" className="mobile-dialog-button" data-tone="primary" disabled={busy}>{t("common.save")}</button>
      </div>
    </form> : null}
  </MobileDialog>;
}

function AddComputerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslation();
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const digits = normalizePairingCode(code);
  const close = () => { setAddress(""); setCode(""); setError(null); onClose(); };
  const submit = async () => {
    if (!digits || !address.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await useEnvironments.getState().addComputer(address, digits);
      close();
    } catch (reason) {
      setError(reason instanceof EnvironmentError ? t(reason.key) : formatUnknownError(reason));
    } finally {
      setBusy(false);
    }
  };
  return <MobileDialog open={open} title={t("environments.add")} onClose={close}>
    <form className="mobile-env-dialog" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p className="mobile-help">{t("environments.addHelp")}</p>
      <label className="mobile-env-field"><span>{t("environments.address")}</span>
        <input className="mobile-input mobile-env-input" value={address} onChange={(event) => { setAddress(event.target.value); setError(null); }} placeholder={t("environments.addressPlaceholder")} inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="next" />
      </label>
      <label className="mobile-env-field"><span>{t("environments.code")}</span>
        <input className="mobile-input" value={code} onChange={(event) => { setCode(event.target.value); setError(null); }} inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000 000" aria-invalid={error ? true : undefined} enterKeyHint="go" />
      </label>
      <p className="mobile-help">{t("environments.codeHelp")}</p>
      {error ? <p role="alert" className="mobile-help text-danger">{error}</p> : null}
      <div className="mobile-dialog-actions">
        <button type="button" className="mobile-dialog-button" onClick={close}>{t("common.cancel")}</button>
        <button type="submit" className="mobile-dialog-button" data-tone="primary" disabled={!digits || !address.trim() || busy}>{busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : null}{t("environments.pair")}</button>
      </div>
    </form>
  </MobileDialog>;
}
