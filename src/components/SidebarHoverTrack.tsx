import { useRef, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const ROWS = ".sidebar-menu-row, .sidebar-project-row, .sidebar-session-row";

/** One quiet highlight that glides between hovered sidebar rows. Listeners stay on this list, never on window. */
export function SidebarHoverTrack({ children, className }: { children: ReactNode; className?: string }) {
  const track = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
  const hide = () => {
    shown.current = false;
    pill.current?.removeAttribute("data-visible");
  };
  const follow = (event: MouseEvent) => {
    const row = (event.target as Element | null)?.closest?.(ROWS);
    const box = track.current, node = pill.current;
    if (!row || !box || !node || !box.contains(row)) return;
    const outer = box.getBoundingClientRect(), inner = row.getBoundingClientRect();
    // The first hover appears in place; only later moves slide, so the list never seems to move by itself.
    node.toggleAttribute("data-instant", !shown.current);
    node.style.transform = `translate(${inner.left - outer.left}px, ${inner.top - outer.top}px)`;
    node.style.width = `${inner.width}px`;
    node.style.height = `${inner.height}px`;
    // The selected row already carries its own fill; the pill fades instead of doubling it.
    node.toggleAttribute("data-on-selected", row.matches(".sidebar-session-selected, [aria-current='page']"));
    node.setAttribute("data-visible", "");
    shown.current = true;
  };
  return <div ref={track} className={cn("sidebar-hover-track", className)} onMouseOver={follow} onMouseLeave={hide} onScrollCapture={hide} onDragStartCapture={hide}>
    <div ref={pill} className="sidebar-hover-pill" aria-hidden="true" />
    {children}
  </div>;
}
