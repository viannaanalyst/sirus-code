import { Children, useLayoutEffect, useRef, type ReactNode } from "react";
import { deckLayout } from "@/lib/toast-deck";
import "@/styles/toast-deck.css";

/**
 * Toasts. On the desktop they stack at the top right like the macOS notification deck: the
 * newest in front, two more peeking behind it smaller, and the deck fans out into a list while
 * the pointer is over it. On the phone they stay at the top center, below the status bar and
 * above sheets, so the clock and island never hide them.
 *
 * Each child sits in its own slot; slots that render nothing take no room. The order is by when
 * a slot gained content, so the newest toast is always in front whatever component it is.
 */
export function TopToastStack({ children, phone = false }: { children: ReactNode; phone?: boolean }) {
  if (phone) return <div className="pointer-events-none fixed top-[calc(env(safe-area-inset-top)+8px)] z-[130] left-1/2 flex w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 flex-col items-stretch gap-2 [&>*]:pointer-events-auto">{children}</div>;
  return <ToastDeck>{children}</ToastDeck>;
}

function ToastDeck({ children }: { children: ReactNode }) {
  const deck = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = deck.current;
    if (!node) return;
    const shownSince = new WeakMap<Element, number>();
    let expanded = false;
    let frame = 0;
    const layout = () => {
      frame = 0;
      const slots = [...node.children] as HTMLElement[];
      const now = performance.now();
      for (const slot of slots) {
        if (slot.childElementCount === 0) shownSince.delete(slot);
        else if (!shownSince.has(slot)) shownSince.set(slot, now);
      }
      const shown = slots.filter(slot => shownSince.has(slot)).sort((a, b) => shownSince.get(b)! - shownSince.get(a)!);
      const placed = deckLayout(shown.map(slot => slot.offsetHeight), expanded);
      shown.forEach((slot, depth) => {
        const place = placed.items[depth];
        slot.style.transform = `translateY(${place.y}px) scale(${place.scale})`;
        slot.style.opacity = String(place.opacity);
        slot.style.zIndex = String(100 - depth);
        slot.inert = !place.interactive;
        slot.dataset.depth = String(depth);
      });
      for (const slot of slots) if (!shownSince.has(slot)) { slot.style.transform = ""; slot.style.opacity = ""; slot.inert = false; delete slot.dataset.depth; }
      node.style.height = `${placed.height}px`;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(layout); };
    const mutations = new MutationObserver(schedule);
    mutations.observe(node, { childList: true, subtree: true });
    const sizes = new ResizeObserver(schedule);
    const watch = () => { for (const slot of node.children) sizes.observe(slot); };
    watch();
    const enter = () => { expanded = true; schedule(); };
    const leave = () => { expanded = false; schedule(); };
    node.addEventListener("pointerenter", enter);
    node.addEventListener("pointerleave", leave);
    node.addEventListener("focusin", enter);
    node.addEventListener("focusout", event => { if (!node.contains(event.relatedTarget as Node | null)) leave(); });
    layout();
    return () => { cancelAnimationFrame(frame); mutations.disconnect(); sizes.disconnect(); node.removeEventListener("pointerenter", enter); node.removeEventListener("pointerleave", leave); node.removeEventListener("focusin", enter); };
  }, []);
  return <div ref={deck} className="toast-deck" role="region" aria-live="polite">
    {Children.toArray(children).map((child, index) => <div key={index} className="toast-deck-slot">{child}</div>)}
  </div>;
}
