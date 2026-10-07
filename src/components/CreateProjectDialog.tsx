import { useState } from "react";
import { client } from "@/client";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Input } from "@/components/arc/input/input";
import { FolderOpen } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { lastProjectParent, projectTarget, rememberProjectParent, validProjectName } from "@/lib/new-project";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { useAppStore } from "@/store/app-store";

/** "Create new project…": a name and a parent folder; Rust makes the folder, Git repo and first commit. */
export function CreateProjectDialog() {
  const t = useTranslation();
  const open = useAppStore((state) => state.createProjectOpen);
  const [name, setName] = useState("");
  const [parent, setParent] = useState(lastProjectParent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stays mounted so closing animates; each opening starts empty from the last parent used.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) { setWasOpen(open); if (open) { setName(""); setParent(lastProjectParent()); setError(null); } }
  const close = () => useAppStore.getState().setCreateProjectOpen(false);
  const target = projectTarget(parent, name);
  const ready = validProjectName(name) && Boolean(parent.trim());
  const submit = async () => {
    if (busy || !ready) return;
    setBusy(true); setError(null);
    try {
      await useAppStore.getState().createProject(name, parent);
      rememberProjectParent(parent);
      close();
    } catch (reason) { setError(formatUnknownError(reason)); } finally { setBusy(false); }
  };
  const browse = async () => {
    const folder = await client.pickFolder().catch(() => null);
    if (folder) setParent(folder);
  };
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) close(); }}>
    <DialogContent title={t("newProject.title")} description={t("newProject.help")} className="w-[min(460px,calc(100vw-32px))]">
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="mt-4"><Input label={t("newProject.name")} autoFocus required maxLength={100} value={name} placeholder={t("newProject.namePlaceholder")} onChange={(event) => setName(event.target.value)} disabled={busy} /></div>
        <div className="mt-3 flex items-end gap-2">
          <div className="min-w-0 flex-1"><Input label={t("newProject.parent")} required value={parent} onChange={(event) => setParent(event.target.value)} disabled={busy} className="font-mono" /></div>
          <InteractiveButton variant="secondary" glow={false} disabled={busy} onClick={() => void browse()} aria-label={t("newProject.browse")}><FolderOpen size={14} aria-hidden="true" />{t("newProject.browse")}</InteractiveButton>
        </div>
        <p className="mt-2 truncate font-mono ui-caption text-text-muted" title={target ?? undefined}>{target ? t("newProject.target", { path: target }) : name.trim() ? t("newProject.invalidName") : " "}</p>
        {error ? <p role="alert" className="mt-2 ui-caption text-danger">{t(error)}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <InteractiveButton variant="ghost" disabled={busy} onClick={close}>{t("common.cancel")}</InteractiveButton>
          <InteractiveButton type="submit" variant="secondary" loading={busy} disabled={!ready}>{t("newProject.create")}</InteractiveButton>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
