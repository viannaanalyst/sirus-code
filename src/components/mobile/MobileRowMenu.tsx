import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronLeft, ChevronRight } from "@/components/icons";
import { usePhoneTranslation as useTranslation } from "./use-phone-host";
import { motionTokens } from "@/lib/motion";
import { contextMenuTop } from "@/lib/phone-home";

export interface RowMenuEntry {
  id: string;
  label: string;
  icon: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  /** A second card with these choices, the current one checked. */
  submenu?: { id: string; label: string; checked: boolean; onSelect: () => void }[];
}

/** Row height and card padding in `mobile-home.css`, so the card's height is known before it draws. */
const ITEM_HEIGHT = 46;
const CARD_PADDING = 12;
const MENU_WIDTH = 268;

/**
 * A conversation's long-press menu (ADR-129): the screen dims, the
 * pressed row lifts as a pill and a glass card opens under it (above it near the bottom). An
 * item with choices opens a second card over the first, the current choice checked. A tap on
 * the dimmed screen or Escape closes it.
 */
export function MobileRowMenu({ open, anchor, preview, items, note, onClose }: {
  open: boolean;
  anchor: HTMLElement | null;
  preview: ReactNode;
  items: RowMenuEntry[];
  /** A short line above the items, such as "Mac is offline" (ADR-132). */
  note?: string;
  onClose: () => void;
}) {
  const t = useTranslation();
  const [submenu, setSubmenu] = useState<string | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!open) return;
    setSubmenu(null);
    setRect(anchor?.getBoundingClientRect() ?? null);
  }, [open, anchor]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSubmenu((current) => { if (!current) onClose(); return null; });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const width = Math.min(MENU_WIDTH, window.innerWidth - 24);
  const height = (items.length + (note ? 1 : 0)) * ITEM_HEIGHT + CARD_PADDING;
  const place = rect ? contextMenuTop(rect, height, window.innerHeight) : null;
  const left = rect ? Math.max(12, Math.min(rect.left + 6, window.innerWidth - width - 12)) : 12;
  const nested = items.find((item) => item.id === submenu)?.submenu ?? null;
  const nestedItem = items.find((item) => item.id === submenu);
  const nestedHeight = nested ? (nested.length + 1) * ITEM_HEIGHT + CARD_PADDING : 0;
  const nestedTop = place && nestedItem
    ? Math.max(12, Math.min(place.top + (items.indexOf(nestedItem) + (note ? 1 : 0)) * ITEM_HEIGHT, window.innerHeight - nestedHeight - 12))
    : 0;

  return createPortal(<AnimatePresence>
    {open && rect && place ? <motion.div key="row-menu" className="mobile-row-menu-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: motionTokens.fast }}>
      <div className="mobile-row-menu-scrim" onClick={onClose} />
      <motion.div className="mobile-row-lift" aria-hidden="true" inert style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        initial={{ scale: 1 }} animate={{ scale: 1.03 }} exit={{ scale: 1 }} transition={{ duration: motionTokens.normal, ease: motionTokens.ease }}>
        {preview}
      </motion.div>
      <motion.div role="menu" aria-label={t("phoneHome.menu")} className="mobile-row-menu mobile-glass" style={{ top: place.top, left, width, transformOrigin: place.above ? "bottom left" : "top left" }}
        initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: nested ? 0.55 : 1, scale: nested ? 0.97 : 1 }} exit={{ opacity: 0, scale: 0.94 }}
        transition={{ duration: motionTokens.normal, ease: motionTokens.ease }}>
        {note ? <p className="mobile-row-menu-note" role="note">{note}</p> : null}
        {items.map((item) => <button key={item.id} type="button" role="menuitem" disabled={item.disabled} tabIndex={nested ? -1 : 0} aria-haspopup={item.submenu ? "menu" : undefined}
          className="mobile-row-menu-item" data-destructive={item.destructive || undefined}
          onClick={() => { if (item.submenu) { setSubmenu(item.id); return; } onClose(); item.onSelect?.(); }}>
          <span className="mobile-row-menu-icon" aria-hidden="true">{item.icon}</span>
          <span className="mobile-row-menu-label">{item.label}</span>
          {item.submenu ? <ChevronRight size={14} className="mobile-row-menu-chevron" aria-hidden="true" /> : null}
        </button>)}
      </motion.div>
      <AnimatePresence>
        {nested && nestedItem ? <motion.div key={nestedItem.id} role="menu" aria-label={nestedItem.label} className="mobile-row-menu mobile-row-submenu mobile-glass"
          style={{ top: nestedTop, left: Math.min(left + 18, window.innerWidth - width - 12), width }}
          initial={{ opacity: 0, scale: 0.92, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: motionTokens.normal, ease: motionTokens.ease }}>
          <button type="button" className="mobile-row-menu-item mobile-row-submenu-head" aria-label={t("phoneHome.back")} onClick={() => setSubmenu(null)}>
            <span className="mobile-row-menu-icon" aria-hidden="true"><ChevronLeft size={16} /></span>
            <span className="mobile-row-menu-label">{nestedItem.label}</span>
          </button>
          {nested.map((choice) => <button key={choice.id} type="button" role="menuitemradio" aria-checked={choice.checked} className="mobile-row-menu-item"
            onClick={() => { onClose(); if (!choice.checked) choice.onSelect(); }}>
            <span className="mobile-row-menu-icon" aria-hidden="true">{choice.checked ? <Check size={16} /> : null}</span>
            <span className="mobile-row-menu-label">{choice.label}</span>
          </button>)}
        </motion.div> : null}
      </AnimatePresence>
    </motion.div> : null}
  </AnimatePresence>, document.body);
}
