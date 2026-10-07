import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Checkbox } from "@/components/arc/checkbox/checkbox";
import { useTranslation } from "@/i18n/use-translation";
import { motionTokens } from "@/lib/motion";
import { useAppStore } from "@/store/app-store";

/** A centred glass card over a dimmed screen (ADR-084); tapping outside or Escape closes it. */
export function MobileDialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, onClose]);
  return createPortal(<AnimatePresence>
    {open ? <motion.div key="dialog" className="mobile-dialog-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: motionTokens.fast }} onClick={onClose}>
      <motion.div role="dialog" aria-modal="true" aria-label={title} className="mobile-dialog mobile-glass" initial={{ opacity: 0, scale: 0.94, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: motionTokens.normal, ease: motionTokens.ease }} onClick={(event) => event.stopPropagation()}>
        <h2 className="mobile-dialog-title">{title}</h2>
        {children}
      </motion.div>
    </motion.div> : null}
  </AnimatePresence>, document.body);
}

/** A small glass menu under a button; each item runs once and closes the menu. */
export function MobileMenu({ open, anchor, onClose, items }: {
  open: boolean;
  anchor: HTMLElement | null;
  onClose: () => void;
  items: { id: string; label: string; icon: ReactNode; destructive?: boolean; disabled?: boolean; onSelect: () => void }[];
}) {
  const rect = anchor?.getBoundingClientRect();
  return createPortal(<AnimatePresence>
    {open && rect ? <>
      <motion.div key="scrim" className="mobile-menu-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div key="menu" role="menu" className="mobile-menu mobile-glass" style={{ top: rect.bottom + 8, right: Math.max(12, window.innerWidth - rect.right), width: 220, transformOrigin: "top right" }}
        initial={{ opacity: 0, scale: 0.94, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: motionTokens.fast, ease: motionTokens.ease }}>
        {items.map((item) => <button key={item.id} type="button" role="menuitem" disabled={item.disabled} className="mobile-menu-item" data-destructive={item.destructive || undefined} onClick={() => { onClose(); item.onSelect(); }}>
          <span className="mobile-field-icon">{item.icon}</span><span className="mobile-menu-label">{item.label}</span>
        </button>)}
      </motion.div>
    </> : null}
  </AnimatePresence>, document.body);
}

/**
 * Deleting a conversation from the phone, under the Mac's rules: a working one cannot be
 * deleted, and an isolated worktree goes too only when asked (refused if it has changes).
 */
export function MobileDeleteDialog({ session, open, onClose, onDeleted }: { session: import("@/client/types").Session | null; open: boolean; onClose: () => void; onDeleted?: () => void }) {
  const t = useTranslation();
  const [removeWorktree, setRemoveWorktree] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setRemoveWorktree(false); }, [open]);
  const submit = async () => {
    if (!session || busy) return;
    setBusy(true);
    const done = await useAppStore.getState().deleteSession(session.id, removeWorktree);
    setBusy(false);
    if (!done) return;
    onClose();
    onDeleted?.();
  };
  return <MobileDialog open={open} title={t("session.delete")} onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p className="mobile-help mobile-dialog-text">{t("session.deleteHelp")}</p>
      {session?.worktree.isolated ? <div className="mobile-dialog-option"><Checkbox label={t("session.removeWorktree")} checked={removeWorktree} onCheckedChange={(value) => setRemoveWorktree(value === true)} disabled={busy} /></div> : null}
      <div className="mobile-dialog-actions">
        <button type="button" className="mobile-dialog-button" disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
        <button type="submit" className="mobile-dialog-button" data-tone="danger" disabled={busy}>{t("session.delete")}</button>
      </div>
    </form>
  </MobileDialog>;
}
