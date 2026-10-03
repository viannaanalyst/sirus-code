import { type PointerEvent } from "react";

export function setPointerGlow(event: PointerEvent<HTMLElement>) {
  const node = event.currentTarget;
  const rect = node.getBoundingClientRect();
  node.style.setProperty("--mouse-x", `${event.clientX - rect.left}px`);
  node.style.setProperty("--mouse-y", `${event.clientY - rect.top}px`);
}

export function clearPointerGlow(event: PointerEvent<HTMLElement>) {
  event.currentTarget.style.removeProperty("--mouse-x");
  event.currentTarget.style.removeProperty("--mouse-y");
}
