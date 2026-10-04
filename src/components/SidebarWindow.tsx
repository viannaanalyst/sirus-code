import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motionTokens } from "@/lib/motion";
import { SIDEBAR_WINDOW_GAP, SIDEBAR_WINDOW_THRESHOLD, windowRange } from "@/lib/sidebar-window";

/**
 * A project folder's disclosure. Closed folders do not mount their session rows;
 * rows stay mounted only while the close transition plays.
 */
export function SidebarDisclosure({ open, children }: { open: boolean; children: ReactNode }) {
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  useEffect(() => {
    if (open || !present) return;
    // Also covers reduced motion, where no transition end fires.
    const timer = setTimeout(() => setPresent(false), motionTokens.normal * 1000 + 50);
    return () => clearTimeout(timer);
  }, [open, present]);
  return <div className="sidebar-disclosure" data-open={open} inert={!open} aria-hidden={!open}>
    <div className="sidebar-disclosure-inner">{present ? children : null}</div>
  </div>;
}

/**
 * Long session lists render only the rows near the sidebar's visible area, with
 * padding standing in for the rest. Rows have one uniform height (measured).
 */
export function SidebarWindowedRows<T>({ items, rowKey, renderRow }: { items: readonly T[]; rowKey: (item: T) => string; renderRow: (item: T) => ReactNode }) {
  const list = useRef<HTMLDivElement>(null);
  const rowHeight = useRef(28);
  const windowed = items.length > SIDEBAR_WINDOW_THRESHOLD;
  const [range, setRange] = useState({ start: 0, end: Math.min(items.length, SIDEBAR_WINDOW_THRESHOLD) });

  useLayoutEffect(() => {
    const node = list.current;
    const viewport = node?.closest<HTMLElement>(".sidebar-project-list");
    if (!windowed || !node || !viewport) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const first = node.querySelector<HTMLElement>(":scope > [data-sidebar-row]");
      if (first?.offsetHeight) rowHeight.current = first.offsetHeight;
      const listTop = node.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
      const next = windowRange(items.length, rowHeight.current, listTop, viewport.scrollTop, viewport.clientHeight);
      setRange((current) => current.start === next.start && current.end === next.end ? current : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    viewport.addEventListener("scroll", schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(viewport);
    return () => { cancelAnimationFrame(frame); viewport.removeEventListener("scroll", schedule); resize.disconnect(); };
  }, [windowed, items.length]);

  const start = windowed ? Math.min(range.start, items.length) : 0;
  const end = windowed ? Math.min(range.end, items.length) : items.length;
  const step = rowHeight.current + SIDEBAR_WINDOW_GAP;
  return <div ref={list} className="sidebar-window" style={windowed ? { paddingTop: start * step, paddingBottom: (items.length - end) * step } : undefined}>
    {items.slice(start, end).map((item) => <div key={rowKey(item)} data-sidebar-row="">{renderRow(item)}</div>)}
  </div>;
}
