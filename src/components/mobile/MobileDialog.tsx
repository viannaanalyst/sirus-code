import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { motionTokens } from "@/lib/motion";

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
