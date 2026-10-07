import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown } from "@/components/icons/phosphor";
import { motionTokens } from "@/lib/motion";

export interface MobileOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
}

/**
 * A phone dropdown (ADR-084): a field that opens a glass menu under it (or above it
 * near the bottom), with icons and a check on the current choice. Tapping outside closes it.
 */
export function MobileSelect<T extends string>({ label, value, options, onChange, placeholder, disabled = false }: {
  label: string;
  value: T | null;
  options: readonly MobileOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const field = useRef<HTMLButtonElement>(null);
  const list = useId();
  const current = options.find((option) => option.value === value) ?? null;

  useLayoutEffect(() => {
    if (!open || !field.current) return;
    const rect = field.current.getBoundingClientRect();
    const height = window.visualViewport?.height ?? window.innerHeight;
    const below = height - rect.bottom - 16;
    const above = rect.top - 16;
    // Open toward the larger side; long lists scroll inside.
    setPlace(below >= Math.min(320, above)
      ? { left: rect.left, width: rect.width, top: rect.bottom + 6, maxHeight: Math.max(160, below) }
      : { left: rect.left, width: rect.width, bottom: height - rect.top + 6, maxHeight: Math.max(160, above) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  return <>
    <button ref={field} type="button" className="mobile-field" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? list : undefined} disabled={disabled} onClick={() => setOpen((value) => !value)}>
      {current?.icon ? <span className="mobile-field-icon">{current.icon}</span> : null}
      <span className="mobile-field-text">
        <span className="mobile-field-label">{label}</span>
        <span className="mobile-field-value" data-empty={current ? undefined : ""}>{current?.label ?? placeholder ?? ""}</span>
      </span>
      <ChevronDown size={15} className="mobile-field-chevron" aria-hidden="true" />
    </button>
    {createPortal(<AnimatePresence>
      {open && place ? <>
        <motion.div key="scrim" className="mobile-menu-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
        <motion.div
          key="menu"
          id={list}
          role="listbox"
          aria-label={label}
          className="mobile-menu mobile-glass"
          style={{ left: place.left, width: place.width, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight, transformOrigin: place.top !== undefined ? "top center" : "bottom center" }}
          initial={{ opacity: 0, scale: 0.96, y: place.top !== undefined ? -6 : 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: motionTokens.fast, ease: motionTokens.ease }}
        >
          {options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} className="mobile-menu-item" onClick={() => { onChange(option.value); setOpen(false); }}>
            {option.icon ? <span className="mobile-field-icon">{option.icon}</span> : null}
            <span className="mobile-field-text">
              <span className="mobile-menu-label">{option.label}</span>
              {option.description ? <span className="mobile-field-label">{option.description}</span> : null}
            </span>
            {option.value === value ? <Check size={15} className="mobile-menu-check" aria-hidden="true" /> : null}
          </button>)}
        </motion.div>
      </> : null}
    </AnimatePresence>, document.body)}
  </>;
}
