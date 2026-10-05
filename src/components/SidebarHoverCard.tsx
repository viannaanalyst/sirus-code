import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PopoverAnchor } from "@radix-ui/react-popover";
import { Popover, PopoverContent } from "@/primitives/Popover";
import { motionTokens } from "@/lib/motion";

const HoverCardsContext = createContext<{ activeId: string | null; show: (id: string) => void; dismiss: (id: string) => void; hold: (id: string, open: boolean) => void } | null>(null);

/** Portalled row actions must not reopen cards through restored or bubbled focus. */
export function useSidebarHoverCardHold(open: boolean) {
  const owner = useContext(HoverCardsContext);
  const hold = owner?.hold;
  const id = useId();
  useLayoutEffect(() => {
    if (!open || !hold) return;
    hold(id, true);
    return () => hold(id, false);
  }, [open, hold, id]);
}

/** One active card per sidebar; late leave timers cannot dismiss the next row. */
export function SidebarHoverCards({ children, disabled = false }: { children: ReactNode; disabled?: boolean }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const held = useRef(new Set<string>());
  const show = useCallback((id: string) => { if (!disabled && held.current.size === 0) setActiveId(id); }, [disabled]);
  const dismiss = useCallback((id: string) => setActiveId(current => current === id ? null : current), []);
  const hold = useCallback((id: string, open: boolean) => {
    if (open) { held.current.add(id); setActiveId(null); }
    else held.current.delete(id);
  }, []);
  const value = useMemo(() => ({ activeId: disabled ? null : activeId, show, dismiss, hold }), [activeId, disabled, show, dismiss, hold]);
  return <HoverCardsContext value={value}>{children}</HoverCardsContext>;
}

/** Event-driven hover/focus card. The project card remains reachable across its gap. */
export function SidebarHoverCard({ children, content, label }: { children: ReactNode; content: ReactNode; label: string }) {
  const owner = useContext(HoverCardsContext);
  if (!owner) throw new Error("SidebarHoverCard requires SidebarHoverCards");
  const id = useId();
  const open = owner.activeId === id;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const keep = () => { if (timer.current) clearTimeout(timer.current); };
  const close = () => { keep(); owner.dismiss(id); };
  const show = () => { keep(); owner.show(id); };
  const closeSoon = () => { keep(); timer.current = setTimeout(() => owner.dismiss(id), motionTokens.fast * 1000); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <Popover open={open} onOpenChange={(value) => value ? show() : close()}>
    <PopoverAnchor asChild><div ref={anchor} className="sidebar-card-anchor" onMouseEnter={show} onMouseLeave={closeSoon}
      onFocus={(event) => { if (anchor.current?.contains(event.target)) show(); }} onBlur={(event) => { if (!anchor.current?.contains(event.relatedTarget as Node | null)) closeSoon(); }} onClickCapture={close} onContextMenuCapture={close} onDragStartCapture={close}
      onKeyDown={(event) => { if (event.key === "ArrowRight" && open && card.current?.querySelector("button")) { event.preventDefault(); card.current.querySelector<HTMLButtonElement>("button")?.focus(); } }}>
      {children}
    </div></PopoverAnchor>
    <PopoverContent ref={card} side="right" align="start" sideOffset={10} collisionPadding={10} className="floating-material sidebar-hover-card" aria-label={label}
      onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}
      onInteractOutside={(event) => { if (event.target instanceof Node && anchor.current?.contains(event.target)) event.preventDefault(); }}
      onMouseEnter={keep} onMouseLeave={closeSoon} onFocus={keep} onBlur={closeSoon}
      onClick={close}>{content}</PopoverContent>
  </Popover>;
}
