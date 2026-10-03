import { useSidebarPanelHold } from "@/components/SidebarPanelHold";
import { useSidebarHoverCardHold } from "@/components/SidebarHoverCard";
import { ContextMenu } from "@/components/arc/context-menu/context-menu";
import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import type { Project } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/primitives/Dropdown";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { useAppStore } from "@/store/app-store";

export function ProjectActions({ project, children }: { project: Project; children?: ReactNode }) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useSidebarPanelHold(menuOpen || open);
  // The row hover card must not float above the confirmation.
  useSidebarHoverCardHold(menuOpen || open);
  const remove = async () => {
    if (busy) return false;
    setBusy(true);
    try { await useAppStore.getState().removeProject(project.id); return true; }
    catch (error) { useAppStore.setState({ error: formatUnknownError(error) }); return false; }
    finally { setBusy(false); }
  };
  return <>
    {children ? <ContextMenu onOpenChange={setMenuOpen} activation="context-only" label={t("project.actions")} items={[{ id: "remove", label: t("Remove from list"), onSelect: () => setOpen(true) }]}>{children}</ContextMenu> : <Dropdown onOpenChange={setMenuOpen}>
      <DropdownTrigger asChild><button type="button" aria-label={t("project.actions")} className="flex size-6 items-center justify-center rounded opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 hover:bg-background-3"><MoreHorizontal size={14} /></button></DropdownTrigger>
      <DropdownContent><DropdownItem onSelect={() => setOpen(true)}>{t("Remove from list")}</DropdownItem></DropdownContent>
    </Dropdown>}
    <ConfirmDialog open={open} onOpenChange={setOpen} busy={busy} title={`${t("Remove from list")} · ${project.name}`} description={t("project.removeHelp")} confirmLabel={t("Remove from list")} onConfirm={remove}
      onCloseAutoFocus={(event) => { event.preventDefault(); document.querySelector<HTMLButtonElement>('[data-open-project]')?.focus(); }} />
  </>;
}
