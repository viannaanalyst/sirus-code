import type { Message } from "@/client/types";

export interface MessageTrailItem {
  id: string;
  ordinal: number;
  preview: string;
  responsePreview: string;
}

const previews = new WeakMap<Message, string>();
function preview(message: Message): string {
  const cached = previews.get(message);
  if (cached !== undefined) return cached;
  // Only the beginning is needed, including while an assistant response streams.
  const text = message.content.slice(0, 4096).replace(/\s+/g, " ").trim();
  const result = text.length > 280 ? `${text.slice(0, 280).trimEnd()}…` : text;
  previews.set(message, result);
  return result;
}

/** One entry per user message; the last nonempty reply before the next user wins. */
export function deriveMessageTrail(messages: readonly Message[]): MessageTrailItem[] {
  const items: MessageTrailItem[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      items.push({ id: message.id, ordinal: items.length + 1, preview: preview(message), responsePreview: "" });
    } else if (message.role === "agent" && items.length) {
      const response = preview(message);
      if (response) items[items.length - 1].responsePreview = response;
    }
  }
  return items;
}

export interface MessageTrailAnchor { id: string; top: number; bottom: number }
export interface MessageTrailPosition { currentId: string | null; visibleIds: string[] }

/** A long reply still belongs to the last user message above the viewport. */
export function resolveMessageTrailPosition(anchors: readonly MessageTrailAnchor[], top: number, bottom: number, readingInset = 0): MessageTrailPosition {
  if (!anchors.length || !Number.isFinite(top)) return { currentId: null, visibleIds: [] };
  const readingTop = top + (Number.isFinite(readingInset) ? Math.max(0, readingInset) : 0);
  let low = 0, high = anchors.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (anchors[middle].top <= readingTop + 1) low = middle + 1;
    else high = middle;
  }
  const currentId = anchors[Math.max(0, low - 1)].id;
  const visibleIds: string[] = [];
  const end = Number.isFinite(bottom) ? Math.max(top, bottom) : top;
  let start = Math.max(0, low - 1);
  while (start > 0 && anchors[start - 1].bottom >= top) start--;
  for (let index = start; index < anchors.length; index++) {
    const anchor = anchors[index];
    if (anchor.top > end) break;
    if (anchor.bottom >= top) visibleIds.push(anchor.id);
  }
  return { currentId, visibleIds };
}

/** Cache geometry on resize; scrolling only searches offsets and updates the rail. */
export function observeMessageTrail(
  viewport: HTMLElement,
  content: HTMLElement,
  ids: readonly string[],
  nodes: ReadonlyMap<string, HTMLElement>,
  changed: (position: MessageTrailPosition) => void,
): () => void {
  let anchors: MessageTrailAnchor[] = [];
  let geometryDirty = true;
  let readingInset = 0;
  let frame = 0;
  let last: MessageTrailPosition = { currentId: null, visibleIds: [] };
  const measure = () => {
    frame = 0;
    if (geometryDirty) {
      // The latest-turn reserve leaves its request at the viewport's top padding,
      // even at maximum scroll. That request is already the turn being read.
      readingInset = parseFloat(getComputedStyle(viewport).paddingTop) || 0;
      const origin = viewport.getBoundingClientRect().top - viewport.scrollTop;
      anchors = ids.flatMap(id => {
        const node = nodes.get(id);
        if (!node) return [];
        const box = node.getBoundingClientRect();
        return [{ id, top: box.top - origin, bottom: box.bottom - origin }];
      });
      geometryDirty = false;
    }
    const next = resolveMessageTrailPosition(anchors, viewport.scrollTop, viewport.scrollTop + viewport.clientHeight, readingInset);
    if (next.currentId !== last.currentId || next.visibleIds.length !== last.visibleIds.length || next.visibleIds.some((id, index) => id !== last.visibleIds[index])) {
      last = next;
      changed(next);
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
  const observer = new ResizeObserver(() => { geometryDirty = true; schedule(); });
  observer.observe(viewport);
  observer.observe(content);
  viewport.addEventListener("scroll", schedule, { passive: true });
  schedule();
  return () => {
    viewport.removeEventListener("scroll", schedule);
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}
