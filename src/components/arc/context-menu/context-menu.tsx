"use client";

import { createPortal } from "react-dom";
import { Fragment, useEffect, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, KeyboardEvent, ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useArcReducedMotion as useReducedMotion } from "../lib/use-arc-motion";
import { Check, Copy, Trash2 } from "@/components/icons/phosphor";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./context-menu.module.css";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  checked?: boolean;
  /** Items of different groups are separated by a rule; destructive actions get their own group. */
  group?: string;
}

export interface ContextMenuProps {
  children: ReactNode;
  items: ContextMenuItem[];
  label?: string;
  activation?: "click-and-context" | "context-only";
  /** Keep the menu in its trigger subtree when used inside a modal focus scope. */
  portal?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Keeps the trigger in the text flow (a file name inside a sentence). */
  inline?: boolean;
}

type Highlight = { index: number; top: number; height: number; danger: boolean; glide: boolean };

const MENU_WIDTH = 208;

export function ContextMenu({ children, items, label = "Context menu", activation = "click-and-context", portal: usePortal = true, onOpenChange, inline = false }: ContextMenuProps) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  // The portal mounts on first open (client only) and stays so the menu can animate out.
  const [portal, setPortal] = useState(false);
  // Each open gets its own key, so reopening at a new point fades the old menu out in place
  // and grows a fresh one from the pointer instead of teleporting the visible menu.
  const [point, setPoint] = useState({ x: 0, y: 0, originX: 0, originY: 0, key: 0 });
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const pointer = useRef(false);
  const clearTimer = useRef(0);
  // A primary press on the target while the menu is open closes it; the click that follows must not reopen it.
  const pressedWhileOpen = useRef(false);
  // An exiting menu keeps its last props, so its handlers check this before moving focus or selecting.
  const live = useRef(false);

  useEffect(() => { live.current = open; }, [open]);
  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);
  useEffect(() => () => window.clearTimeout(clearTimer.current), []);
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnViewportChange = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("scroll", closeOnViewportChange, true);
    window.addEventListener("resize", closeOnViewportChange);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("scroll", closeOnViewportChange, true);
      window.removeEventListener("resize", closeOnViewportChange);
    };
  }, [open, point.key]);

  function showMenu(x: number, y: number) {
    const menuHeight = Math.min(300, items.length * 40 + 16);
    const left = Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8));
    // The menu grows from the pointer, even when it is clamped away from a viewport edge.
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : targetRef.current;
    const rect = !usePortal ? targetRef.current?.getBoundingClientRect() : undefined;
    setPoint(current => ({ x: left - (rect?.left ?? 0), y: top - (rect?.top ?? 0), originX: Math.max(0, Math.min(MENU_WIDTH, x - left)), originY: Math.max(0, Math.min(menuHeight, y - top)), key: current.key + 1 }));
    window.clearTimeout(clearTimer.current);
    pointer.current = false;
    setHighlight(null);
    setPortal(true);
    setOpen(true);
  }

  function onTargetKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const rect = targetRef.current?.getBoundingClientRect();
      if (rect) showMenu(rect.left + 12, rect.bottom + 8);
    }
  }

  function onTargetClick() {
    if (pressedWhileOpen.current) { pressedWhileOpen.current = false; return; }
    const rect = targetRef.current?.getBoundingClientRect();
    if (rect) showMenu(rect.left + 12, rect.bottom + 8);
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const enabled = items.map((item, index) => ({ item, index })).filter(({ item }) => !item.disabled);
    const current = document.activeElement?.getAttribute("data-index");
    const currentPosition = enabled.findIndex(({ index }) => String(index) === current);
    let nextPosition: number | undefined;
    if (event.key === "ArrowDown") nextPosition = (currentPosition + 1) % enabled.length;
    if (event.key === "ArrowUp") nextPosition = currentPosition < 0 ? enabled.length - 1 : (currentPosition - 1 + enabled.length) % enabled.length;
    if (event.key === "Home") nextPosition = 0;
    if (event.key === "End") nextPosition = enabled.length - 1;
    if (nextPosition !== undefined && enabled.length) {
      event.preventDefault();
      event.currentTarget.querySelector<HTMLElement>(`[data-index="${enabled[nextPosition].index}"]`)?.focus();
    }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); (restoreFocus.current?.isConnected ? restoreFocus.current : targetRef.current)?.focus(); }
  }

  function place(item: HTMLElement, glide: boolean) {
    window.clearTimeout(clearTimer.current);
    const next = { index: Number(item.dataset.index), top: item.offsetTop, height: item.offsetHeight, danger: item.dataset.tone === "danger" };
    setHighlight(current => ({ ...next, glide: glide && current !== null }));
  }

  // Keyboard focus places the highlight instantly; the pointer makes it glide between rows.
  function onMenuFocus(event: FocusEvent<HTMLDivElement>) {
    const item = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[role="menuitem"]') : null;
    if (item) {
      // A pointer-opened menu focuses its first row without showing a highlight, like a native menu.
      if (!pointer.current && item.matches(":focus-visible")) place(item, false);
      return;
    }
    // A short grace period keeps the highlight gliding across the gap between rows.
    window.clearTimeout(clearTimer.current);
    clearTimer.current = window.setTimeout(() => setHighlight(null), pointer.current ? 70 : 0);
  }

  const panel = <AnimatePresence>
      {open && <motion.div key={point.key} ref={node => { if (node) menuRef.current = node; }} data-appearance-floating="true" className={styles.menu} data-arc-menu-open={open ? "true" : undefined} role="menu" aria-label={label} tabIndex={-1} style={{ position: usePortal ? "fixed" : "absolute", pointerEvents: "auto", left: point.x, top: point.y, transformOrigin: `${point.originX}px ${point.originY}px` }} onClick={event => event.stopPropagation()} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={onMenuKeyDown} onFocus={onMenuFocus} onPointerMoveCapture={() => { pointer.current = true; }} onKeyDownCapture={() => { pointer.current = false; }} onPointerLeave={event => { if (live.current) event.currentTarget.focus({ preventScroll: true }); }}
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} exit={reduced ? { opacity: 0, transition: { duration: motionTokens.duration.exit } } : { opacity: 0, scale: .98, transition: { duration: motionTokens.duration.exit, ease: [...motionTokens.ease.standard] } }} transition={reduced ? { duration: motionTokens.duration.instant } : { default: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.enter] }, opacity: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.enter] } }}>
        <motion.span className={styles.highlight} data-tone={highlight?.danger ? "danger" : undefined} aria-hidden="true" initial={false} animate={highlight ? { y: highlight.top, height: highlight.height, opacity: 1 } : { opacity: 0 }} transition={{ default: highlight?.glide && !reduced ? motionTokens.spring.snappy : { duration: 0 }, opacity: { duration: reduced ? 0 : .08 } }}/>
        {items.map((item, index) => <Fragment key={item.id}>{index > 0 && (item.group ?? (item.destructive ? "danger" : "")) !== (items[index - 1].group ?? (items[index - 1].destructive ? "danger" : "")) ? <div role="separator" className={styles.separator} /> : null}<button type="button" role="menuitem" tabIndex={-1} data-index={index} data-tone={item.destructive ? "danger" : undefined} style={{ "--i": index } as CSSProperties} disabled={item.disabled} className={[styles.item, item.destructive ? styles.destructive : ""].filter(Boolean).join(" ")} onPointerMove={event => { if (!live.current) return; window.clearTimeout(clearTimer.current); if (document.activeElement !== event.currentTarget) event.currentTarget.focus({ preventScroll: true }); if (highlight?.index !== index) place(event.currentTarget, true); }} onPointerLeave={() => { if (live.current) menuRef.current?.focus({ preventScroll: true }); }} onClick={() => { if (!live.current) return; live.current = false; item.onSelect?.(); setOpen(false); (restoreFocus.current?.isConnected ? restoreFocus.current : targetRef.current)?.focus(); }}>
          <span className={styles.icon} aria-hidden="true">{item.icon ?? (item.checked ? <Check size={15} /> : null)}</span><span>{item.label}</span>
        </button></Fragment>)}
      </motion.div>}
    </AnimatePresence>;

  return <>
    <div ref={targetRef} className={styles.target} style={{ ...(usePortal ? {} : { position: "relative" as const }), ...(inline ? { display: "inline" } : {}) }} tabIndex={activation === "context-only" ? undefined : 0} onPointerDown={event => { if (menuRef.current?.contains(event.target as Node)) return; pressedWhileOpen.current = open && event.button === 0; }} onClick={activation === "context-only" ? undefined : onTargetClick} onContextMenu={event => { event.preventDefault(); showMenu(event.clientX, event.clientY); }} onKeyDown={onTargetKeyDown} aria-label={label} aria-haspopup="menu" aria-expanded={open}>
      {children}
      {portal && !usePortal ? panel : null}
    </div>
    {portal && usePortal ? createPortal(panel, document.body) : null}
  </>;
}

export const contextMenuExampleItems: ContextMenuItem[] = [
  { id: "copy", label: "Copy link", icon: <Copy size={15} /> },
  { id: "delete", label: "Delete project", icon: <Trash2 size={15} />, destructive: true },
];

export default ContextMenu;
