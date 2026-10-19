import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { useTranslation } from "@/i18n/use-translation";
import { appUpdatePercent } from "@/lib/app-update";
import { parseReleaseNotes, releaseNotesCount, type ReleaseNotesSection } from "@/lib/release-notes";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { useAppStore } from "@/store/app-store";
import { useAppUpdate } from "@/store/app-update-store";
import "@/styles/app-update.css";

/**
 * The update pill in the window header (ADR-140): "Update 0.2.0" when a version is on offer,
 * a progress ring while it downloads, "Restart to update" once installed. Clicking opens the
 * version's notes and its one action. Restarting goes through the running-agents guard.
 */
export function AppUpdatePill() {
  const t = useTranslation();
  const status = useAppUpdate(state => state.status);
  const pending = useAppUpdate(state => state.pending);
  const installRequested = useAppUpdate(state => state.installRequested);
  const bind = useAppUpdate(state => state.bind);
  const [open, setOpen] = useState(false);
  useEffect(() => bind(), [bind]);
  useRememberInstalledNotes();
  if (!status) return null;
  const phase = status.phase;
  const failedInstall = phase === "failed" && installRequested;
  if (!["available", "downloading", "installing", "installed"].includes(phase) && !failedInstall) return null;
  const version = status.version ?? status.currentVersion;
  const percent = appUpdatePercent(status);
  const busy = phase === "downloading" || phase === "installing";
  const label = phase === "installed" ? t("appUpdate.pillRestart")
    : phase === "installing" ? t("appUpdate.pillInstalling")
    : phase === "downloading" ? (percent == null ? t("appUpdate.pillDownloading") : t("appUpdate.pillPercent", { percent }))
    : failedInstall ? t("appUpdate.pillFailed")
    : t("appUpdate.pillAvailable", { version });
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" className="app-update-pill titlebar-no-drag" data-phase={failedInstall ? "failed" : phase} aria-label={label}>
        {busy ? <ProgressRing value={phase === "installing" ? 100 : percent ?? 6} /> : <span className="app-update-pill-dot" aria-hidden="true" />}
        <span className="tabular-nums">{label}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent side="bottom" align="end" sideOffset={8} className="app-update-panel w-[340px] p-0">
      <UpdatePanel pending={pending} onClose={() => setOpen(false)} />
    </PopoverContent>
  </Popover>;
}

function UpdatePanel({ pending, onClose }: { pending: boolean; onClose: () => void }) {
  const t = useTranslation();
  const locale = useAppStore(state => state.settings.locale);
  const status = useAppUpdate(state => state.status)!;
  const download = useAppUpdate(state => state.download);
  const restart = useAppUpdate(state => state.restart);
  const version = status.version ?? status.currentVersion;
  const sections = parseReleaseNotes(status.notes);
  const percent = appUpdatePercent(status);
  const megabytes = (bytes: number) => (bytes / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 });
  const date = status.date ? new Date(status.date) : null;
  return <div className="app-update-panel-body">
    <p className="app-update-panel-title">{status.phase === "installed" ? t("appUpdate.readyTitle", { version }) : t("appUpdate.panelTitle", { version })}</p>
    <p className="app-update-panel-sub">
      {t("appUpdate.youUse", { version: status.currentVersion })}
      {date && !Number.isNaN(date.getTime()) ? ` · ${date.toLocaleDateString(locale, { day: "numeric", month: "short" })}` : ""}
    </p>
    {sections.length ? <div className="app-update-notes scroll-thin"><NotesList sections={sections} /></div> : <p className="app-update-panel-sub">{t("appUpdate.noNotes")}</p>}
    {status.phase === "downloading" || status.phase === "installing" ? <>
      <div className="app-update-progress" aria-hidden="true"><span style={{ width: `${status.phase === "installing" ? 100 : percent ?? 6}%` }} /></div>
      <p className="app-update-panel-sub app-update-progress-label tabular-nums">
        <span>{status.phase === "installing" ? t("appUpdate.installingShort") : percent == null ? t("appUpdate.pillDownloading") : `${percent}%`}</span>
        {status.total ? <span>{t("appUpdate.size", { done: megabytes(status.downloaded), total: megabytes(status.total) })}</span> : null}
      </p>
    </> : null}
    {status.phase === "failed" && status.error ? <p role="alert" className="app-update-error">{status.error}</p> : null}
    <div className="app-update-actions">
      {status.phase === "available" || status.phase === "failed" ? <>
        <InteractiveButton variant="primary" className="flex-1" disabled={pending} onClick={() => void download()}>{t(status.phase === "failed" ? "appUpdate.retry" : "appUpdate.download")}</InteractiveButton>
        <InteractiveButton variant="toolbar" onClick={onClose}>{t("appUpdate.later")}</InteractiveButton>
      </> : status.phase === "installed" ? <>
        <InteractiveButton variant="primary" className="flex-1" disabled={pending} onClick={() => void restart()}>{t("appUpdate.restartNow")}</InteractiveButton>
        <InteractiveButton variant="toolbar" onClick={onClose}>{t("appUpdate.onQuit")}</InteractiveButton>
      </> : <p className="app-update-panel-sub">{t("appUpdate.keepWorking")}</p>}
    </div>
  </div>;
}

function NotesList({ sections }: { sections: ReleaseNotesSection[] }) {
  return <>{sections.map((section, index) => <section key={index} className="app-update-notes-section">
    {section.title ? <h4>{section.title}</h4> : null}
    <ul>{section.items.map((item, position) => <li key={position}>{item}</li>)}</ul>
  </section>)}</>;
}

function ProgressRing({ value }: { value: number }) {
  const radius = 5, circumference = 2 * Math.PI * radius;
  return <svg className="app-update-ring" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <circle cx="7" cy="7" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
    <circle cx="7" cy="7" r={radius} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeDasharray={`${(circumference * Math.max(0, Math.min(100, value))) / 100} ${circumference}`} transform="rotate(-90 7 7)" />
  </svg>;
}

/** Once a version is installed, its notes are kept so its first launch can show What's new. */
function useRememberInstalledNotes() {
  const status = useAppUpdate(state => state.status);
  useEffect(() => {
    if (status?.phase !== "installed" || !status.version) return;
    const store = useAppStore.getState();
    if (store.settings.appUpdateNotes?.version === status.version) return;
    void store.saveSettings({ ...store.settings, appUpdateNotes: { version: status.version, notes: (status.notes ?? "").slice(0, 4000), date: status.date, seen: false } });
  }, [status?.phase, status?.version, status?.notes, status?.date]);
}

/**
 * What's new (ADR-140): on the first launch of a version whose notes were kept at install,
 * once, unless turned off in Settings. Settings → About opens it again (`forced`).
 */
export function WhatsNewDialog({ forced = false, onClose }: { forced?: boolean; onClose?: () => void }) {
  const t = useTranslation();
  const status = useAppUpdate(state => state.status);
  const notes = useAppStore(state => state.settings.appUpdateNotes);
  const enabled = useAppStore(state => state.settings.appUpdateWhatsNew);
  const locale = useAppStore(state => state.settings.locale);
  const due = !!notes && !!status && notes.version === status.currentVersion && !notes.seen && enabled;
  const open = forced ? !!notes : due;
  const close = () => {
    const store = useAppStore.getState();
    const saved = store.settings.appUpdateNotes;
    if (saved && !saved.seen) void store.saveSettings({ ...store.settings, appUpdateNotes: { ...saved, seen: true } });
    onClose?.();
  };
  if (!notes) return null;
  const sections = parseReleaseNotes(notes.notes);
  const date = notes.date ? new Date(notes.date) : null;
  const when = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }) : null;
  const hero = <div className="whats-new-hero" aria-hidden="true"><span className="whats-new-tag">{t("appUpdate.versionTag", { version: notes.version })}</span></div>;
  return <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
    <DialogContent title={t("appUpdate.whatsNewTitle")} description={when ?? undefined} hero={hero} variant="plain" className="whats-new w-[min(560px,calc(100vw-32px))]">
      <div className="whats-new-body scroll-thin">
        {sections.length ? <NotesList sections={sections} /> : <p className="app-update-panel-sub">{t("appUpdate.noNotes")}</p>}
      </div>
      <div className="whats-new-foot">
        <span className="app-update-panel-sub">{t("appUpdate.changes", { count: releaseNotesCount(sections) })}</span>
        <InteractiveButton variant="primary" onClick={close}>{t("appUpdate.continue")}</InteractiveButton>
      </div>
    </DialogContent>
  </Dialog>;
}
