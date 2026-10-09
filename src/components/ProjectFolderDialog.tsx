import { useState } from "react";
import type { ProjectFolder, ProjectLook } from "@/client/types";
import { client } from "@/client";
import { ProjectGlyph } from "@/components/ProjectGlyph";
import { LookPicker, type LookPick } from "@/components/ProjectIdentityField";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { applyLookChange, createFolder, moveProjectToFolder, updateFolder } from "@/lib/project-folders";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { useAppStore } from "@/store/app-store";

/**
 * New or edit project folder: a name and an icon (emoji, line icon, Astro or an image) in a
 * colour, with the same picker as projects. `projectId` puts that project in a new folder.
 */
export function ProjectFolderDialog({ folder, projectId, open, onOpenChange }: { folder?: ProjectFolder; projectId?: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslation();
  const [name, setName] = useState(folder?.name ?? "");
  const [look, setLook] = useState<ProjectLook>(folder?.look ?? {});
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(open);
  // Each opening starts from the saved folder.
  if (open !== shown) {
    setShown(open);
    if (open) { setName(folder?.name ?? ""); setLook(folder?.look ?? {}); }
  }
  const pick = (change: LookPick) => {
    if (change.kind !== "pickImage") { setLook((current) => applyLookChange(current, change)); return; }
    setBusy(true);
    void client.pickLookImage()
      .then((logo) => { if (logo) setLook((current) => applyLookChange(current, { kind: "logo", logo })); })
      .catch((error: unknown) => useAppStore.setState({ error: formatUnknownError(error) }))
      .finally(() => setBusy(false));
  };
  const save = async () => {
    const store = useAppStore.getState();
    let settings = store.settings;
    if (folder) settings = updateFolder(settings, folder.id, { name, look });
    else {
      const id = crypto.randomUUID();
      settings = updateFolder(createFolder(settings, id, name), id, { look });
      if (projectId) settings = moveProjectToFolder(settings, projectId, id);
    }
    await store.saveSettings(settings);
    return true;
  };
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) onOpenChange(value); }}>
    <DialogContent title={t(folder ? "folders.edit" : "folders.new")} description={t("folders.help")} className="w-[min(420px,calc(100vw-32px))]">
      <form onSubmit={(event) => { event.preventDefault(); if (busy || !name.trim()) return; setBusy(true); void save().then((saved) => { if (saved) onOpenChange(false); }).finally(() => setBusy(false)); }}>
        <div className="project-identity">
          <span className="project-identity-label ui-control">{t("folders.name")}</span>
          <div className="project-identity-field">
            <LookPicker look={look} glyph={<ProjectGlyph project={{ look }} size={18} />} busy={busy} onPick={pick} />
            <input className="project-identity-input ui-control" autoFocus required maxLength={80} value={name} placeholder={t("folders.placeholder")} aria-label={t("folders.name")} onChange={(event) => setName(event.target.value)} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <InteractiveButton variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>{t("common.cancel")}</InteractiveButton>
          <InteractiveButton type="submit" loading={busy} disabled={!name.trim()}>{t(folder ? "common.save" : "folders.create")}</InteractiveButton>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
