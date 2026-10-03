import { useSidebarPanelHold } from "@/components/SidebarPanelHold";
import { useSidebarHoverCardHold } from "@/components/SidebarHoverCard";
import { ContextMenu } from "@/components/arc/context-menu/context-menu";
import type { ReactNode } from "react";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Checkbox } from "@/components/arc/checkbox/checkbox";
import { Input } from "@/components/arc/input/input";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import type { Session } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/primitives/Dropdown";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { useAppStore } from "@/store/app-store";

export function SessionActions({ session, children }: { session: Session; children?: ReactNode }) {
  const t = useTranslation();
  const [action, setAction] = useState<"rename" | "delete" | null>(null);
  const [title, setTitle] = useState(session.title);
  const [removeWorktree, setRemoveWorktree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useSidebarPanelHold(menuOpen || action !== null);
  useSidebarHoverCardHold(menuOpen || action !== null);
  const active = ["starting", "running", "waiting"].includes(session.status);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const store = useAppStore.getState();
      const done = action === "rename" ? await store.renameSession(session.id, title) : await store.deleteSession(session.id, removeWorktree);
      if (done) setAction(null);
    } finally { setBusy(false); }
  };
  return <Dialog open={action !== null} onOpenChange={(open) => { if (!open && !busy) setAction(null); }}>
    {children ? <ContextMenu onOpenChange={setMenuOpen} activation="context-only" label={t("session.actions")} items={[
      { id: "rename", label: t("session.rename"), onSelect: () => { setTitle(session.title); setAction("rename"); } },
      { id: "delete", label: t("session.delete"), disabled: active, destructive: true, onSelect: () => { setRemoveWorktree(false); setAction("delete"); } },
    ]}>{children}</ContextMenu> : <Dropdown onOpenChange={setMenuOpen}>
      <DropdownTrigger asChild><button type="button" aria-label={t("session.actions")} className="flex size-6 items-center justify-center rounded opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 hover:bg-background-3"><MoreHorizontal size={14} /></button></DropdownTrigger>
      <DropdownContent>
        <DropdownItem onSelect={() => { setTitle(session.title); setAction("rename"); }}>{t("session.rename")}</DropdownItem>
        <DropdownItem disabled={active} onSelect={() => { setRemoveWorktree(false); setAction("delete"); }}>{t("session.delete")}</DropdownItem>
      </DropdownContent>
    </Dropdown>}
    <DialogContent title={t(action === "rename" ? "session.rename" : "session.delete")} description={t(action === "rename" ? "session.renameHelp" : "session.deleteHelp")} variant={action === "delete" ? "confirm" : "default"} className="w-[min(420px,calc(100vw-32px))]" onCloseAutoFocus={(event) => {
      if (action === "delete") { event.preventDefault(); document.querySelector<HTMLButtonElement>('[data-new-session]')?.focus(); }
    }}>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          {action === "rename" ? <div className="mt-4"><Input label={t("session.titleOptional")} autoFocus required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} /></div> : session.worktree.isolated ? <div><Checkbox label={t("session.removeWorktree")} checked={removeWorktree} onCheckedChange={(value) => setRemoveWorktree(value === true)} disabled={busy} /></div> : null}

          <div className={`${action === "delete" ? (session.worktree.isolated ? "mt-4" : "") : "mt-5"} flex justify-end gap-2`}>
            <InteractiveButton variant="ghost" disabled={busy} onClick={() => setAction(null)}>{t("common.cancel")}</InteractiveButton>
            <InteractiveButton type="submit" variant={action === "delete" ? "danger" : "secondary"} glow={action !== "delete"} loading={busy} disabled={action === "rename" && !title.trim()}>{t(action === "rename" ? "common.save" : "session.delete")}</InteractiveButton>
          </div>
        </form>
    </DialogContent>
  </Dialog>;
}
