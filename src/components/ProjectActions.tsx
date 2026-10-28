import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { client } from "@/client";
import type { Project } from "@/client/types";
import { ContextMenu, type ContextMenuItem } from "@/components/arc/context-menu/context-menu";
import { Copy, Folder, FolderOpen, FolderOutput, FolderPlus, Palette, Pencil, SquarePen, Trash2 } from "@/components/icons";
import { ProjectAppearancePopover } from "@/components/ProjectAppearancePopover";
import { ProjectFolderDialog } from "@/components/ProjectFolderDialog";
import { useSidebarHoverCardHold } from "@/components/SidebarHoverCard";
import { useSidebarPanelHold } from "@/components/SidebarPanelHold";
import { ProjectEditDialog } from "@/components/SidebarRows";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { moveProjectToFolder } from "@/lib/project-folders";
import { PROJECT_MENU_GROUP, projectMenuEntries } from "@/lib/project-menu";
import { sidebarProjectAction } from "@/lib/sidebar-actions";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { useAppStore } from "@/store/app-store";

const fail = (error: unknown) => useAppStore.setState({ error: formatUnknownError(error) });

/**
 * A project's context menu, the same wherever a project shows (ADR-139): `items(project)` for
 * a `ContextMenu`, and `dialogs` (Edit project, New folder with this project, the Remove
 * confirmation) to render once, outside any popover that `onAction` closes. `onAction` runs
 * before the items that leave the menu's surface: New conversation and those opening a dialog.
 */
export function useProjectMenu(onAction?: () => void) {
  const t = useTranslation();
  const folders = useAppStore(state => state.settings.projectFolders);
  const [editing, setEditing] = useState<Project | null>(null);
  const [folderFor, setFolderFor] = useState<string | null>(null);
  // The project stays after closing, so the confirmation keeps its title while it fades out.
  const [removal, setRemoval] = useState<{ project: Project; open: boolean } | null>(null);
  // The Appearance popover keeps its project while it fades out.
  const [appearance, setAppearance] = useState<{ project: Project; open: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const held = editing !== null || folderFor !== null || Boolean(removal?.open);
  useSidebarPanelHold(held);
  // The row hover card must not float above a dialog.
  useSidebarHoverCardHold(held);
  const before = useRef(onAction);
  useLayoutEffect(() => { before.current = onAction; });
  const items = useCallback((project: Project): ContextMenuItem[] => {
    const leave = (then: () => void) => () => { before.current?.(); then(); };
    const move = (folderId: string | null) => () => { const store = useAppStore.getState(); void store.saveSettings(moveProjectToFolder(store.settings, project.id, folderId)); };
    return projectMenuEntries(project.id, folders).map((entry): ContextMenuItem => {
      const group = PROJECT_MENU_GROUP[entry.kind];
      switch (entry.kind) {
        case "new": return { id: "new", group, label: t("sidebarList.newConversation"), icon: <SquarePen size={15} />, onSelect: leave(() => void sidebarProjectAction(project.id, "new")) };
        case "edit": return { id: "edit", group, label: t("Edit project"), icon: <Pencil size={15} />, onSelect: leave(() => setEditing(project)) };
        case "appearance": return { id: "appearance", group, label: t("avatar.menu"), icon: <Palette size={15} />, onSelect: leave(() => setAppearance({ project, open: true })) };
        case "move": return { id: `move:${entry.folder.id}`, group, label: t("folders.moveTo", { folder: entry.folder.name }), icon: <Folder size={15} />, onSelect: move(entry.folder.id) };
        case "out": return { id: "out", group, label: t("folders.removeFrom", { folder: entry.folder.name }), icon: <FolderOutput size={15} />, onSelect: move(null) };
        case "new-folder": return { id: "new-folder", group, label: t("folders.newWith"), icon: <FolderPlus size={15} />, onSelect: leave(() => setFolderFor(project.id)) };
        case "reveal": return { id: "reveal", group, label: t("project.openInFinder"), icon: <FolderOpen size={15} />, onSelect: () => void client.openPath(project.path).catch(fail) };
        case "copy-path": return { id: "copy-path", group, label: t("Copy path"), icon: <Copy size={15} />, onSelect: () => void navigator.clipboard.writeText(project.path).catch(fail) };
        case "remove": return { id: "remove", group, label: t("Remove from list"), icon: <Trash2 size={15} />, destructive: true, onSelect: leave(() => setRemoval({ project, open: true })) };
      }
    });
  }, [folders, t]);
  const openAppearance = useCallback((project: Project) => setAppearance({ project, open: true }), []);
  const remove = async () => {
    if (busy || !removal) return false;
    setBusy(true);
    try { await useAppStore.getState().removeProject(removal.project.id); return true; }
    catch (error) { fail(error); return false; }
    finally { setBusy(false); }
  };
  const dialogs = <>
    {appearance ? <ProjectAppearancePopover project={appearance.project} open={appearance.open} onOpenChange={value => setAppearance(current => current && { ...current, open: value })} /> : null}
    {editing ? <ProjectEditDialog project={editing} open onOpenChange={value => { if (!value) setEditing(null); }} /> : null}
    <ProjectFolderDialog projectId={folderFor ?? undefined} open={folderFor !== null} onOpenChange={value => { if (!value) setFolderFor(null); }} />
    <ConfirmDialog open={Boolean(removal?.open)} onOpenChange={value => setRemoval(current => current && { ...current, open: value })} busy={busy}
      title={`${t("Remove from list")} · ${removal?.project.name ?? ""}`} description={t("project.removeHelp")} confirmLabel={t("Remove from list")} onConfirm={remove}
      onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLButtonElement>("[data-open-project]")?.focus(); }} />
  </>;
  return { items, dialogs, openAppearance };
}

/** One project's right-click menu around `children`, with its own dialogs. */
export function ProjectActions({ project, children }: { project: Project; children: ReactNode }) {
  const t = useTranslation();
  const menu = useProjectMenu();
  const [menuOpen, setMenuOpen] = useState(false);
  useSidebarPanelHold(menuOpen);
  useSidebarHoverCardHold(menuOpen);
  return <>
    <ContextMenu onOpenChange={setMenuOpen} activation="context-only" label={t("project.actions")} items={menu.items(project)}>{children}</ContextMenu>
    {menu.dialogs}
  </>;
}
