import type { CSSProperties } from "react";

/** Index of the first row whose bottom is below `top` (rows are in vertical order); `count` if none. */
export function firstVisibleRow(count: number, bottomAt: (index: number) => number, top: number): number {
  let low = 0, high = count;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (bottomAt(middle) <= top) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Scroll position that keeps an anchor row where it was in the viewport after layout moved it
 * (`before`/`after` are its offsets from the viewport top). Sub-pixel drift is left alone.
 */
export function anchoredScrollTop(scrollTop: number, before: number, after: number): number {
  const delta = after - before;
  return Number.isFinite(delta) && Math.abs(delta) >= 1 ? Math.max(0, scrollTop + delta) : scrollTop;
}

const estimates = new WeakMap<object, CSSProperties>();
/**
 * Rough rendered height of a message, used as its placeholder size before it is first shown
 * (`contain-intrinsic-size: auto`), so never-rendered history is closer to its real height.
 */
export function estimateMessageHeight(content: string, role: "user" | "agent" | string): number {
  const perLine = role === "user" ? 70 : 90;
  let lines = 0;
  for (let start = 0; start <= content.length && lines < 80;) {
    const end = content.indexOf("\n", start);
    const stop = end < 0 ? content.length : end;
    lines += Math.max(1, Math.ceil((stop - start) / perLine));
    if (end < 0) break;
    start = end + 1;
  }
  return Math.min(1600, Math.max(48, Math.round(lines * 24 + (role === "user" ? 20 : 8))));
}

/** Per-row style carrying the height estimate; cached per message object. */
export function messageSizeStyle(message: { content: string; role: string; streaming?: boolean }): CSSProperties | undefined {
  if (message.streaming) return undefined;
  let style = estimates.get(message);
  if (!style) {
    style = { "--row-estimate": `${estimateMessageHeight(message.content, message.role)}px` } as CSSProperties;
    estimates.set(message, style);
  }
  return style;
}

/**
 * How long after the reader's last gesture (wheel step, key, touch, press) a scroll still counts
 * as theirs: trackpad momentum keeps sending wheel events, and a key's smooth step is shorter.
 */
export const GESTURE_WINDOW_MS = 500;
/** How far from the end a reader's scroll up must go before following stops. */
const RELEASE_DISTANCE = 48;

export type ScrollVerdict = "keep" | "release" | "resume" | "repin";

/**
 * What a scroll event means for following. `moved` is the change since the last position seen,
 * `distance` how far the viewport now is from the end, `gesture` whether the reader is scrolling
 * (a recent wheel, key, touch or a held pointer).
 *
 * While following, only the reader's own move up and away releases it. Every other move comes from
 * layout (the end shrinking or the viewport growing clamps the position up, and streamed text then
 * grows before the event arrives), so it re-pins the end instead. Following resumes once the reader
 * is back at the very end moving down.
 */
export function scrollVerdict({ following, moved, distance, gesture }: { following: boolean; moved: number; distance: number; gesture: boolean }): ScrollVerdict {
  if (following) {
    if (!gesture) return distance > 1 ? "repin" : "keep";
    return moved < 0 && distance >= RELEASE_DISTANCE ? "release" : "keep";
  }
  return moved > 0 && distance < 4 ? "resume" : "keep";
}

/**
 * Keep the latest turn at the top until it fills the viewport, then follow its end.
 * When not following, the first visible row stays put while rows above it change height
 * (WebKit has no `overflow-anchor`, and `content-visibility` placeholders grow as history renders).
 */
export function createTranscriptScroll(viewport: HTMLElement, content: HTMLElement, tail: HTMLElement, changed: (following: boolean) => void) {
  let following = true;
  let latest: string | undefined;
  let jumped = false;
  let frame = 0;
  let captureFrame = 0;
  let padding: number | undefined;
  let reserve = -1;
  let rows: HTMLElement[] | null = null;
  let anchor: { node: HTMLElement; offset: number } | null = null;
  // Last scroll position seen, to tell the reader's direction from layout changes.
  let lastTop = 0;
  // When the reader last touched the transcript, and whether a pointer is held on it
  // (dragging a selection scrolls with no further events).
  let gestureAt = Number.NEGATIVE_INFINITY;
  let pressed = false;
  const readPadding = () => {
    const style = getComputedStyle(viewport);
    padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    return padding;
  };
  const pin = () => { viewport.scrollTop = viewport.scrollHeight; lastTop = viewport.scrollTop; };
  const layout = () => {
    frame = 0;
    const next = Math.max(0, viewport.clientHeight - (padding ?? readPadding()));
    if (next !== reserve) { reserve = next; tail.style.minHeight = `${next}px`; }
    if (following) pin();
  };
  // Rows are the grandchildren of `content` (turn groups hold messages and their markers).
  const rowList = () => {
    if (!rows) {
      rows = [];
      for (const group of Array.from(content.children)) for (const row of Array.from(group.children)) rows.push(row as HTMLElement);
    }
    return rows;
  };
  const capture = () => {
    captureFrame = 0;
    if (following) { anchor = null; return; }
    const list = rowList();
    const top = viewport.getBoundingClientRect().top;
    const index = firstVisibleRow(list.length, i => list[i].getBoundingClientRect().bottom, top);
    const node = list[Math.min(index, list.length - 1)];
    anchor = node ? { node, offset: node.getBoundingClientRect().top - top } : null;
  };
  const scheduleCapture = () => { if (!captureFrame) captureFrame = requestAnimationFrame(capture); };
  const observer = new ResizeObserver(entries => {
    rows = null;
    if (entries.some(entry => entry.target === viewport)) padding = undefined;
    // Layout already ran but nothing is painted yet: correct now so the move is never seen.
    if (following) pin();
    else if (anchor && !captureFrame) {
      if (anchor.node.isConnected) {
        const after = anchor.node.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
        const next = anchoredScrollTop(viewport.scrollTop, anchor.offset, after);
        if (next !== viewport.scrollTop) viewport.scrollTop = next;
      } else scheduleCapture();
    }
    if (!frame) frame = requestAnimationFrame(layout);
  });
  observer.observe(viewport);
  observer.observe(content);
  return {
    update(messageId: string | undefined) {
      // A new turn follows again; gestures made before it do not carry over.
      if (latest !== messageId) { latest = messageId; following = true; jumped = false; anchor = null; gestureAt = Number.NEGATIVE_INFINITY; changed(true); }
      layout();
    },
    scroll() {
      scheduleCapture();
      const top = viewport.scrollTop;
      const moved = top - lastTop;
      lastTop = top;
      if (jumped || !moved) return;
      const distance = viewport.scrollHeight - top - viewport.clientHeight;
      const gesture = pressed || performance.now() - gestureAt < GESTURE_WINDOW_MS;
      switch (scrollVerdict({ following, moved, distance, gesture })) {
        case "release": following = false; changed(false); break;
        case "resume": following = true; anchor = null; changed(true); break;
        case "repin": pin(); break;
        case "keep": break;
      }
    },
    /** Before a programmatic jump: stop following; the anchor is taken where the jump lands. */
    detach() { jumped = true; following = false; anchor = null; scheduleCapture(); changed(false); },
    /**
     * The reader touched the transcript. A wheel or trackpad step up releases following at
     * once, so the next streamed frame cannot snap them back; a step without vertical
     * direction (sideways, the end of a momentum swipe) changes nothing, but scrolls that
     * follow it shortly count as the reader's.
     */
    interact(deltaY?: number) {
      jumped = false;
      gestureAt = performance.now();
      if (deltaY !== undefined && deltaY < 0 && following) { following = false; anchor = null; scheduleCapture(); changed(false); }
    },
    /** A pointer is pressed on the transcript (true) or released anywhere (false). */
    hold(down: boolean) { pressed = down; if (!down) gestureAt = performance.now(); },
    follow() { jumped = false; following = true; anchor = null; changed(true); layout(); },
    dispose() { observer.disconnect(); cancelAnimationFrame(frame); cancelAnimationFrame(captureFrame); },
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

/** Keys that scroll the transcript up (it stops following on the press, not after the scroll). */
const UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);

/**
 * The upward intent of a manual scroll gesture on the transcript, or undefined when there is
 * none: a wheel step up, an up key, a touch moving the content down, or a press
 * on the scrollbar itself. Gestures inside nested content that scrolls on its own (a code block,
 * a wide table) stay there and change nothing, nor do keys typed into a field.
 */
export function upwardIntent(viewport: HTMLElement, target: EventTarget | null, gesture:
  | { kind: "wheel"; deltaY: number }
  | { kind: "key"; key: string }
  | { kind: "touch"; deltaY: number }
  | { kind: "pointer"; clientX: number }): number | undefined {
  const element = typeof Element !== "undefined" && target instanceof Element ? target : (target as Element | null)?.closest ? target as Element : null;
  if (gesture.kind === "key") {
    if (element?.closest("input, textarea, [contenteditable='true'], select")) return undefined;
    return UP_KEYS.has(gesture.key) ? -1 : undefined;
  }
  if (gesture.kind === "pointer") {
    // The scrollbar sits past the content box on the right.
    const box = viewport.getBoundingClientRect();
    return gesture.clientX > box.left + viewport.clientWidth ? -1 : undefined;
  }
  const deltaY = gesture.deltaY;
  if (deltaY >= 0) return undefined;
  for (let node = element; node && node !== viewport; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight + 1 && node.scrollTop > 0) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === "auto" || overflow === "scroll") return undefined;
    }
  }
  return deltaY;
}
