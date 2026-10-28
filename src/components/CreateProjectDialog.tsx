import { useEffect, useRef, useState } from "react";
import { client } from "@/client";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Input } from "@/components/arc/input/input";
import { GitHubIcon } from "@/components/icons/BrandIcons";
import { Folder, FolderOpen, Sparkles } from "@/components/icons";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { cloneFolderName, lastProjectMode, lastProjectParent, projectTarget, rememberProjectMode, rememberProjectParent, validProjectName, type ProjectDialogMode } from "@/lib/new-project";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { cn } from "@/lib/cn";
import { useAppStore } from "@/store/app-store";
import { SegmentedControl } from "@/primitives/SegmentedControl";
import { HOME_ENVIRONMENT } from "@/lib/environments";
import { LAST_TARGET_KEY, cloneParentFor } from "@/lib/computers";
import { computerLabel, defaultTarget, useComputers } from "@/store/computers-store";

const MODES = [
  { value: "open", icon: <Folder size={15} aria-hidden="true" />, label: "newProject.modeOpen", help: "newProject.openHelp" },
  { value: "create", icon: <Sparkles size={15} aria-hidden="true" />, label: "newProject.modeCreate", help: "newProject.help" },
  { value: "clone", icon: <span aria-hidden="true"><GitHubIcon size={15} /></span>, label: "newProject.modeClone", help: "newProject.cloneHelp" },
] as const;

/**
 * "New project" (ADR-117): three cards. "Open folder" adds a folder already on disk; "Create from
 * scratch" makes a folder with Git, a README and a first commit; "Clone from GitHub" clones a
 * repository into a parent folder. Every card's fields share one cell, so the dialog keeps its
 * size when the card changes. It reopens on the card used last.
 */
export function CreateProjectDialog() {
  const t = useTranslation();
  const open = useAppStore((state) => state.createProjectOpen);
  const [mode, setMode] = useState<ProjectDialogMode>(lastProjectMode);
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const fields = useRef<HTMLDivElement>(null);
  const [parent, setParent] = useState(lastProjectParent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which computer the project goes to (ADR-133): the last one used, chosen here when there are several.
  const computers = useComputers((state) => state.computers);
  const activeId = useComputers((state) => state.activeId);
  const hostInfo = useComputers((state) => state.hostInfo);
  const [computer, setComputer] = useState(HOME_ENVIRONMENT);
  const onMac = computer === HOME_ENVIRONMENT;
  const pickComputer = (id: string) => {
    setComputer(id);
    // A server's projects live under its own home folder; the Mac's last parent means nothing there.
    setParent(id === HOME_ENVIRONMENT ? lastProjectParent() : cloneParentFor(hostInfo[id]));
  };
  // Stays mounted so closing animates; each opening starts empty from the last parent used.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) { setWasOpen(open); if (open) { const target = computers.length > 1 ? defaultTarget() : HOME_ENVIRONMENT; setComputer(target); setMode(lastProjectMode()); setFolder(""); setName(""); setSource(""); setParent(target === HOME_ENVIRONMENT ? lastProjectParent() : cloneParentFor(hostInfo[target])); setError(null); } }
  const close = () => useAppStore.getState().setCreateProjectOpen(false);
  const choose = (next: ProjectDialogMode) => { setMode(next); setError(null); rememberProjectMode(next); };
  // The visible card's first field takes focus when the dialog opens or the card changes.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => fields.current?.querySelector<HTMLInputElement>(`[data-mode="${mode}"] input`)?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open, mode]);
  const target = projectTarget(parent, name);
  const cloneName = cloneFolderName(source);
  const cloneTarget = cloneName && parent.trim() ? `${parent.trim().replace(/\/+$/, "")}/${cloneName}` : null;
  const ready = mode === "open" ? Boolean(folder.trim()) : mode === "clone" ? Boolean(cloneTarget) : validProjectName(name) && Boolean(parent.trim());
  const submit = async () => {
    if (busy || !ready) return;
    setBusy(true); setError(null);
    try {
      if (computers.length > 1) {
        if (computer !== activeId && !(await useComputers.getState().chooseTarget(computer))) throw new Error(t("computers.offlineNote", { name: computerLabel(computer) }));
        window.localStorage.setItem(LAST_TARGET_KEY, computer);
      }
      if (mode === "open") await useAppStore.getState().openProjectPath(folder.trim());
      else {
        if (mode === "clone") await useAppStore.getState().cloneProject(source, parent);
        else await useAppStore.getState().createProject(name, parent);
        if (onMac) rememberProjectParent(parent);
      }
      close();
    } catch (reason) { setError(formatUnknownError(reason)); } finally { setBusy(false); }
  };
  const browse = async () => {
    const picked = await client.pickFolder().catch(() => null);
    if (picked && mode === "open") setFolder(picked);
    else if (picked) setParent(picked);
  };
  const browseButton = !onMac ? null : <InteractiveButton variant="secondary" glow={false} disabled={busy} onClick={() => void browse()} aria-label={t("newProject.browse")}><FolderOpen size={14} aria-hidden="true" />{t("newProject.browse")}</InteractiveButton>;
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) close(); }}>
    <DialogContent title={t("newProject.title")} variant="plain" className="w-[min(520px,calc(100vw-32px))]">
      {/* The cards choose the path; the fields for it follow. */}
      <div role="radiogroup" aria-label={t("newProject.mode")} className="grid grid-cols-3 gap-2">
        {MODES.map(({ value, icon, label, help }) => {
          const on = mode === value;
          return <button key={value} type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => choose(value)}
            className={cn("flex flex-col items-start rounded-xl border p-3 text-left transition-colors duration-[var(--motion-fast)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--focus-ring)]",
              on ? "border-[color-mix(in_srgb,var(--brand-violet)_55%,transparent)] bg-[var(--brand-violet-soft)]" : "border-border-default bg-background-1 hover:border-[color-mix(in_srgb,var(--text-secondary)_35%,var(--border-default))] hover:bg-background-2")}>
            <span className={cn("mb-2.5 grid size-[30px] place-items-center rounded-[9px] transition-colors duration-[var(--motion-fast)]", on ? "bg-[color-mix(in_srgb,var(--brand-violet)_18%,transparent)] text-[var(--brand-violet)]" : "bg-background-3 text-text-secondary")}>{icon}</span>
            <span className="ui-control font-medium text-text-primary">{t(label)}</span>
            <span className="mt-0.5 ui-caption leading-snug text-text-muted">{t(help)}</span>
          </button>;
        })}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {computers.length > 1 ? <div className="mt-4 flex items-center gap-3">
          <span className="ui-control text-text-secondary">{t("computers.target")}</span>
          <SegmentedControl label={t("computers.target")} value={computer} disabled={busy} onChange={pickComputer}
            options={computers.map((item) => ({ value: item.id, label: computerLabel(item.id) }))} />
        </div> : null}
        {/* All three sets of fields sit in one grid cell; only the chosen one shows, so the height never changes. */}
        <div ref={fields} className="mt-4 grid">
          <div data-mode="open" className={cn("[grid-area:1/1]", mode !== "open" && "invisible")} inert={mode !== "open"}>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1"><Input label={t("newProject.folder")} required={mode === "open"} value={folder} placeholder={t("newProject.folderPlaceholder")} onChange={(event) => setFolder(event.target.value)} disabled={busy} className="font-mono" /></div>
              {browseButton}
            </div>
            <p className="mt-2 ui-caption text-text-muted">{t("newProject.openNote")}</p>
          </div>
          <div data-mode="create" className={cn("[grid-area:1/1]", mode !== "create" && "invisible")} inert={mode !== "create"}>
            <Input label={t("newProject.name")} required={mode === "create"} maxLength={100} value={name} placeholder={t("newProject.namePlaceholder")} onChange={(event) => setName(event.target.value)} disabled={busy} />
            <div className="mt-3 flex items-end gap-2">
              <div className="min-w-0 flex-1"><Input label={t("newProject.parent")} required={mode === "create"} value={parent} onChange={(event) => setParent(event.target.value)} disabled={busy} className="font-mono" /></div>
              {browseButton}
            </div>
            <p className="mt-2 truncate font-mono ui-caption text-text-muted" title={target ?? undefined}>{target ? t("newProject.target", { path: target }) : name.trim() ? t("newProject.invalidName") : " "}</p>
          </div>
          <div data-mode="clone" className={cn("[grid-area:1/1]", mode !== "clone" && "invisible")} inert={mode !== "clone"}>
            <Input label={t("newProject.repository")} required={mode === "clone"} value={source} placeholder={t("newProject.repositoryPlaceholder")} onChange={(event) => setSource(event.target.value)} disabled={busy} className="font-mono" spellCheck={false} autoCapitalize="off" autoCorrect="off" />
            <div className="mt-3 flex items-end gap-2">
              <div className="min-w-0 flex-1"><Input label={t("newProject.cloneParent")} required={mode === "clone"} value={parent} onChange={(event) => setParent(event.target.value)} disabled={busy} className="font-mono" /></div>
              {browseButton}
            </div>
            <p className="mt-2 truncate font-mono ui-caption text-text-muted" title={cloneTarget ?? undefined}>{cloneTarget ? t("newProject.cloneTarget", { path: cloneTarget }) : source.trim() ? t("newProject.invalidRepository") : " "}</p>
          </div>
        </div>
        {error ? <p role="alert" className="mt-2 ui-caption text-danger">{t(error)}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <InteractiveButton variant="ghost" disabled={busy} onClick={close}>{t("common.cancel")}</InteractiveButton>
          <InteractiveButton type="submit" variant="primary" loading={busy} disabled={!ready}>{t(mode === "open" ? "newProject.open" : mode === "clone" ? (busy ? "newProject.cloning" : "newProject.clone") : "newProject.create")}</InteractiveButton>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
