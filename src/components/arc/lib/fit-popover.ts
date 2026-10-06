/** Host adaptation: where an in-flow popover fits inside the nearest clipping ancestor (a scrolling dialog or drawer) or the window. */
export interface PopoverFit { above: boolean; alignEnd: boolean; }

function clipRect(element: HTMLElement): { top: number; bottom: number; left: number; right: number } {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|hidden|clip)/.test(`${style.overflow}${style.overflowX}${style.overflowY}`)) return node.getBoundingClientRect();
  }
  return { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
}

/** Opens below and start-aligned unless the popover would be cut there and fits better above or end-aligned. */
export function fitPopover(anchor: HTMLElement | null, height: number, width: number, gap = 8): PopoverFit {
  if (!anchor) return { above: false, alignEnd: false };
  const rect = anchor.getBoundingClientRect(), clip = clipRect(anchor);
  const below = clip.bottom - rect.bottom - gap, above = rect.top - clip.top - gap;
  return { above: below < height && above > below, alignEnd: rect.left + width > clip.right && rect.right - width >= clip.left - 1 };
}
