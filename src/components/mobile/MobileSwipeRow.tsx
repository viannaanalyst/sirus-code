import { useRef, useState, type ReactNode } from "react";
import { swipeRest } from "@/lib/mobile";

export interface SwipeAction {
  id: string;
  label: string;
  icon: ReactNode;
  tone: "accent" | "warning" | "danger";
  disabled?: boolean;
  onSelect: () => void;
}

const ACTION_WIDTH = 74;

/**
 * A list row that slides left to reveal its actions (ADR-086), as in iOS Mail.
 * The gesture only claims horizontal drags, so the list still scrolls; a tap on a
 * row that is open closes it instead of opening the conversation.
 */
export function MobileSwipeRow({ actions, children }: { actions: SwipeAction[]; children: ReactNode }) {
  const width = actions.length * ACTION_WIDTH;
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; from: number; axis: "x" | "y" | null } | null>(null);
  const moved = useRef(false);

  const close = () => setOffset(0);
  return <div className="mobile-swipe" data-open={offset !== 0 || undefined}>
    <div className="mobile-swipe-actions" style={{ width }} aria-hidden={offset === 0 ? true : undefined}>
      {actions.map((action) => <button key={action.id} type="button" tabIndex={offset === 0 ? -1 : 0} className="mobile-swipe-action" data-tone={action.tone} disabled={action.disabled} onClick={() => { close(); action.onSelect(); }}>
        {action.icon}<span>{action.label}</span>
      </button>)}
    </div>
    <div
      className="mobile-swipe-content"
      data-dragging={dragging || undefined}
      style={{ transform: `translateX(${offset}px)` }}
      onPointerDown={(event) => { if (event.pointerType === "mouse" && event.button !== 0) return; start.current = { x: event.clientX, y: event.clientY, from: offset, axis: null }; moved.current = false; }}
      onPointerMove={(event) => {
        const origin = start.current;
        if (!origin) return;
        const dx = event.clientX - origin.x, dy = event.clientY - origin.y;
        if (!origin.axis) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          origin.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
          if (origin.axis === "x") { setDragging(true); event.currentTarget.setPointerCapture(event.pointerId); }
        }
        if (origin.axis !== "x") return;
        moved.current = true;
        setOffset(Math.max(-width - 24, Math.min(0, origin.from + dx)));
      }}
      onPointerUp={() => { if (start.current?.axis === "x") setOffset((value) => swipeRest(value, width)); start.current = null; setDragging(false); }}
      onPointerCancel={() => { start.current = null; setDragging(false); setOffset((value) => swipeRest(value, width)); }}
      onClickCapture={(event) => {
        // A drag, or a tap on an open row, is not an open.
        if (moved.current) { event.preventDefault(); event.stopPropagation(); moved.current = false; return; }
        if (offset !== 0) { event.preventDefault(); event.stopPropagation(); close(); }
      }}
    >
      {children}
    </div>
  </div>;
}
