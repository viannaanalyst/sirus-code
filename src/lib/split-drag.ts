import type { PointerEvent as ReactPointerEvent } from "react";
import { edgeAt, splitDropState, type SplitTarget } from "@/lib/split-layout";
import { useAppStore } from "@/store/app-store";

/** One pending drag per element: a press that never moved past the threshold is replaced by the next one. */
const pending = new WeakMap<HTMLElement, () => void>();

/** Width of the strip along the panes area that splits the whole area. */
const AREA_EDGE = 28;

/** The pane part under a point: `[data-split-leaf]` inside `[data-split-root]`. */
export function splitTargetAt(x: number, y: number): SplitTarget | null {
  const root = document.querySelector<HTMLElement>("[data-split-root]");
  if (!root) return null;
  const area = root.getBoundingClientRect();
  if (x < area.left || x > area.right || y < area.top || y > area.bottom) return null;
  if (root.querySelectorAll("[data-split-leaf]").length > 1) {
    const edge = x - area.left < AREA_EDGE ? "left" : area.right - x < AREA_EDGE ? "right" : y - area.top < AREA_EDGE ? "top" : area.bottom - y < AREA_EDGE ? "bottom" : null;
    if (edge) return { target: "root", edge };
  }
  const leaf = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-split-leaf]");
  if (!leaf || !root.contains(leaf)) return null;
  const box = leaf.getBoundingClientRect();
  return { target: leaf.dataset.splitLeaf!, edge: edgeAt((x - box.left) / box.width, (y - box.top) / box.height) };
}

/**
 * Starts dragging a conversation toward the panes from a press on `event`'s
 * button (a sidebar row or a pane grip). The button captures the pointer at
 * once, so a fast first movement still reaches it, and a plain click still
 * lands on it; the drag starts after a small movement. Listeners live on that
 * button, never on the window. Escape cancels.
 */
export function beginSplitDrag(event: ReactPointerEvent<HTMLElement>, sessionId: string, title: string) {
  if (event.button !== 0) return;
  const element = event.currentTarget, pointerId = event.pointerId;
  pending.get(element)?.();
  const startX = event.clientX, startY = event.clientY;
  let active = false, done = false;
  let chip: HTMLElement | null = null;

  const update = (x: number, y: number) => {
    chip!.style.transform = `translate(${x + 14}px, ${y + 16}px)`;
    const store = useAppStore.getState();
    const drop = splitTargetAt(x, y);
    const state = drop ? splitDropState(store.splitLayout, sessionId, drop) : "none";
    const current = store.splitDrag;
    if (current?.drop?.target !== drop?.target || current?.drop?.edge !== drop?.edge || current?.state !== state) store.setSplitDrag({ sessionId, drop, state });
  };
  const move = (moved: PointerEvent) => {
    if (moved.pointerId !== pointerId) return;
    if (!active) {
      if (!(moved.buttons & 1)) { finish(); return; }
      if (Math.hypot(moved.clientX - startX, moved.clientY - startY) < 5) return;
      active = true;
      chip = document.createElement("div");
      chip.className = "split-drag-chip ui-control";
      chip.textContent = title;
      document.body.append(chip);
      document.documentElement.dataset.splitDragging = "";
    }
    update(moved.clientX, moved.clientY);
  };
  const up = (released: PointerEvent) => {
    if (released.pointerId !== pointerId) return;
    if (active) {
      // The click that ends a drag must not also open the row.
      const swallow = (click: MouseEvent) => { click.preventDefault(); click.stopPropagation(); };
      element.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => element.removeEventListener("click", swallow, { capture: true }), 0);
      const drag = useAppStore.getState().splitDrag;
      if (drag?.drop && drag.state === "ok") useAppStore.getState().dropOnSplit(sessionId, drag.drop);
    }
    finish();
  };
  const key = (pressed: KeyboardEvent) => {
    if (pressed.key !== "Escape" || !active) return;
    pressed.preventDefault();
    pressed.stopPropagation();
    finish();
  };
  function finish() {
    if (done) return;
    done = true;
    pending.delete(element);
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", up);
    element.removeEventListener("pointercancel", finish);
    element.removeEventListener("lostpointercapture", finish);
    element.removeEventListener("keydown", key);
    chip?.remove();
    delete document.documentElement.dataset.splitDragging;
    if (active) useAppStore.getState().setSplitDrag(null);
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  }
  pending.set(element, finish);
  element.setPointerCapture(pointerId);
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", finish);
  element.addEventListener("lostpointercapture", finish);
  element.addEventListener("keydown", key);
}
