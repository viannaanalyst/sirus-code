import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export type DropEdge = "before" | "after";

/**
 * Reordering by pointer capture instead of HTML5 drag and drop, which the
 * macOS webview does not deliver reliably. Once the pointer moves past a small
 * threshold the row captures it (no window listeners) and reports the row
 * under the pointer (`[data-reorder-id]` inside the same `[data-reorder-scope]`)
 * and the half it is over; release calls `onDrop`. The click that ends a drag
 * is swallowed so it does not also activate the row.
 */
export function usePointerReorder({ axis = "y", canDrop = () => true, onDrop }: {
  axis?: "x" | "y";
  canDrop?: (source: string, target: string) => boolean;
  onDrop: (source: string, target: string, edge: DropEdge) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; edge: DropEdge } | null>(null);
  const start = useRef<{ id: string; x: number; y: number; active: boolean; scope: Element | null } | null>(null);
  const swallowClick = useRef(false);

  const target = (x: number, y: number) => {
    const state = start.current;
    const node = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-reorder-id]");
    if (!state || !node || !state.scope?.contains(node)) return null;
    const id = node.dataset.reorderId!;
    if (id === state.id || !canDrop(state.id, id)) return null;
    // A row may nest its own handle with the same ID (a folder and its open
    // sessions); the edge then follows the handle, not the whole group.
    const rect = (node.querySelector<HTMLElement>(`[data-reorder-id="${CSS.escape(id)}"]`) ?? node).getBoundingClientRect();
    const edge: DropEdge = axis === "y" ? (y < rect.top + rect.height / 2 ? "before" : "after") : (x < rect.left + rect.width / 2 ? "before" : "after");
    return { id, edge };
  };

  const finish = () => { start.current = null; setDragging(null); setOver(null); };

  const bind = useCallback((id: string) => ({
    "data-reorder-id": id,
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      swallowClick.current = false;
      if (event.button !== 0 || (event.target as HTMLElement).closest("input,textarea,select,[data-no-reorder]")) return;
      start.current = { id, x: event.clientX, y: event.clientY, active: false, scope: event.currentTarget.closest("[data-reorder-scope]") };
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const state = start.current;
      if (!state) return;
      if (!state.active) {
        if (!(event.buttons & 1)) { start.current = null; return; }
        if (Math.hypot(event.clientX - state.x, event.clientY - state.y) < 5) return;
        // Capture only once a drag starts, so a plain click (labels,
        // checkboxes, row selection) keeps its normal target.
        state.active = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(state.id);
      }
      setOver(target(event.clientX, event.clientY));
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      const state = start.current;
      if (!state) return;
      if (state.active) {
        swallowClick.current = true;
        const hit = target(event.clientX, event.clientY);
        if (hit) onDrop(state.id, hit.id, hit.edge);
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
