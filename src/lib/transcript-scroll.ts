/** Keep the latest turn at the top until it fills the viewport, then follow its end. */
export function createTranscriptScroll(viewport: HTMLElement, content: HTMLElement, tail: HTMLElement, changed: (following: boolean) => void) {
  let following = true;
  let anchor: string | undefined;
  let jumped = false;
  let frame = 0;
  const layout = () => {
    const style = getComputedStyle(viewport);
    tail.style.minHeight = `${Math.max(0, viewport.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0))}px`;
    if (following) viewport.scrollTop = viewport.scrollHeight;
  };
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(layout);
  });
  observer.observe(viewport);
  observer.observe(content);
  return {
    update(messageId: string | undefined) {
      if (anchor !== messageId) { anchor = messageId; following = true; jumped = false; changed(true); }
      layout();
    },
    scroll() {
      if (jumped) return;
      const next = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 48;
      if (next !== following) { following = next; changed(next); }
    },
    detach() { jumped = true; following = false; changed(false); },
    interact() { jumped = false; },
    follow() { jumped = false; following = true; changed(true); layout(); },
    dispose() { observer.disconnect(); cancelAnimationFrame(frame); },
  };
}

/**
 * Brings `target` into view by scrolling only `viewport` (never the window or other ancestors,
 * which `scrollIntoView` would also move, shifting the whole app up under the titlebar).
 */
export function scrollWithin(viewport: HTMLElement, target: HTMLElement, block: "start" | "center" = "start") {
  const top = target.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
  const offset = block === "center" ? (viewport.clientHeight - target.getBoundingClientRect().height) / 2 : 0;
  viewport.scrollTop = Math.max(0, top - offset);
}
