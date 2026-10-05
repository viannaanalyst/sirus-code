import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export type DropEdge = "before" | "after";

interface Drag {
  id: string;
  x: number;
  y: number;
  active: boolean;
  scope: Element | null;
  /** Top-level reorderable items of the scope and their resting boxes, measured when the drag starts. */
  items: HTMLElement[];
  rects: DOMRect[];
  from: number;
  to: number;
}

/** Top-level `[data-reorder-id]` items of a scope; a nested handle with the same ID belongs to its group. */
function scopeItems(scope: Element): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>("[data-reorder-id]")].filter((node) => {
    const parent = node.parentElement?.closest("[data-reorder-id]");
    return !parent || !scope.contains(parent);
  });
}

const SETTLE = "transform var(--motion-normal, 220ms) var(--ease-out, cubic-bezier(.22,1,.36,1))";

/**
 * Reordering by pointer capture instead of HTML5 drag and drop, which the
 * macOS webview does not deliver reliably. Once the pointer moves past a small
 * threshold the item lifts and follows the pointer while its neighbours slide
 * aside to open its slot (no window listeners); release calls `onDrop` with the
 * neighbour it lands beside. The click that ends a drag is swallowed so it does
 * not also activate the row. Transforms are written directly on the items and
 * cleared at the end, so lists re-render only when the drag starts and ends.
 */
export function usePointerReorder({ axis = "y", canDrop = () => true, onDrop }: {
  axis?: "x" | "y";
  canDrop?: (source: string, target: string) => boolean;
  onDrop: (source: string, target: string, edge: DropEdge) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; edge: DropEdge } | null>(null);
  const start = useRef<Drag | null>(null);
  const swallowClick = useRef(false);

  const reset = (state: Drag | null) => {
    state?.items.forEach((item) => {
      item.style.transform = "";
      item.style.transition = "";
      item.style.zIndex = "";
      item.removeAttribute("data-reorder-lifted");
    });
  };

  const finish = () => { reset(start.current); start.current = null; setDragging(null); setOver(null); };

  /** The slot the pointer is over, from the resting midpoints of the other items. */
  const slot = (state: Drag, position: number) => {
    const mid = (rect: DOMRect) => axis === "x" ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
    let to = state.from;
    state.rects.forEach((rect, index) => {
      if (index === state.from) return;
      if (index > state.from && position > mid(rect)) to = Math.max(to, index);
      if (index < state.from && position < mid(rect)) to = Math.min(to, index);
    });
    const target = state.items[to]?.dataset.reorderId;
    return to !== state.from && target && canDrop(state.id, target) ? to : state.from;
  };

  const paint = (state: Drag, delta: number) => {
    const size = (rect: DOMRect) => axis === "x" ? rect.width : rect.height;
    const gap = state.rects.length > 1 ? Math.max(0, axis === "x"
      ? state.rects[1].left - state.rects[0].right
      : state.rects[1].top - state.rects[0].bottom) : 0;
    const moved = size(state.rects[state.from]) + gap;
    state.items.forEach((item, index) => {
      if (index === state.from) {
        item.style.transform = `${axis === "x" ? `translateX(${delta}px)` : `translateY(${delta}px)`} scale(1.03)`;
        return;
      }
      let shift = 0;
      if (state.from < state.to && index > state.from && index <= state.to) shift = -moved;
      if (state.from > state.to && index < state.from && index >= state.to) shift = moved;
      item.style.transform = shift ? (axis === "x" ? `translateX(${shift}px)` : `translateY(${shift}px)`) : "";
    });
  };

  const bind = useCallback((id: string) => ({
    "data-reorder-id": id,
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      swallowClick.current = false;
      if (event.button !== 0 || (event.target as HTMLElement).closest("input,textarea,select,[data-no-reorder]")) return;
      start.current = { id, x: event.clientX, y: event.clientY, active: false, scope: event.currentTarget.closest("[data-reorder-scope]"), items: [], rects: [], from: -1, to: -1 };
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const state = start.current;
      if (!state) return;
      if (!state.active) {
        if (!(event.buttons & 1)) { start.current = null; return; }
        if (Math.hypot(event.clientX - state.x, event.clientY - state.y) < 5) return;
        const items = state.scope ? scopeItems(state.scope) : [];
        const from = items.findIndex((item) => item.dataset.reorderId === state.id);
        if (from < 0) { start.current = null; return; }
        // Capture only once a drag starts, so a plain click (labels,
        // checkboxes, row selection) keeps its normal target.
        state.active = true;
        state.items = items;
        state.rects = items.map((item) => item.getBoundingClientRect());
        state.from = state.to = from;
        items.forEach((item, index) => {
          item.style.transition = index === from ? "none" : SETTLE;
          if (index === from) { item.style.zIndex = "5"; item.setAttribute("data-reorder-lifted", ""); }
        });
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(state.id);
      }
      const position = axis === "x" ? event.clientX : event.clientY;
      // The lifted item stays inside its list's span.
      const first = state.rects[0], last = state.rects[state.rects.length - 1], own = state.rects[state.from];
      const min = axis === "x" ? first.left - own.left : first.top - own.top;
      const max = axis === "x" ? last.right - own.right : last.bottom - own.bottom;
      const delta = Math.max(min, Math.min(max, position - (axis === "x" ? state.x : state.y)));
      const to = slot(state, position);
      if (to !== state.to) {
        state.to = to;
        const target = state.items[to]?.dataset.reorderId;
        setOver(to === state.from || !target ? null : { id: target, edge: to > state.from ? "after" : "before" });
      }
      paint(state, delta);
    },
    onPointerUp: () => {
      const state = start.current;
      if (!state) return;
      if (state.active) {
        swallowClick.current = true;
        const target = state.items[state.to]?.dataset.reorderId;
        if (state.to !== state.from && target) {
          finish();
          onDrop(state.id, target, state.to > state.from ? "after" : "before");
          return;
        }
      }
      finish();
    },
    onPointerCancel: finish,
    // The webview can drop the capture mid-drag; end it instead of leaving a stuck row.
    onLostPointerCapture: () => { if (start.current?.active) finish(); },
    onClickCapture: (event: React.MouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [axis, canDrop, onDrop]);

  return { bind, dragging, over };
}
