import { useLayoutEffect, type RefObject } from "react";

/** Elements measured as a whole; text is measured line by line. */
const INLINE_BOXES = "img, svg, button, .attachment-chip, .composer-token, .prompt-reference";

/**
 * The widest rendered line inside `box`, from its content edge: text lines plus inline boxes.
 * Block containers are skipped, since they always span the full width.
 */
export function contentWidth(box: HTMLElement): number {
  const style = getComputedStyle(box);
  const left = box.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
  let right = left;
  const range = document.createRange();
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) right = Math.max(right, rect.right);
  }
  for (const element of box.querySelectorAll(INLINE_BOXES)) right = Math.max(right, element.getBoundingClientRect().right);
  return right - left;
}

/**
 * A bubble hugs its widest line. CSS keeps a wrapped block at its maximum width, which left an
 * empty strip beside text that broke onto a new line. `key` changes when the content does.
 */
export function useHugWidth(ref: RefObject<HTMLElement | null>, enabled: boolean, key: unknown) {
  useLayoutEffect(() => {
    const box = ref.current;
    if (!enabled || !box) return;
    const container = box.parentElement?.parentElement ?? box.parentElement;
    let frame = 0;
    let lastWidth = -1;
    const fit = () => {
      box.style.width = "";
      const style = getComputedStyle(box);
      const chrome = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      // One spare pixel: subpixel text widths must not wrap the last word again.
      const width = Math.ceil(contentWidth(box) + chrome) + 1;
      // Only narrow it: a measurement wider than the natural box would just re-wrap the text.
      if (width > chrome && width < box.getBoundingClientRect().width - 1) box.style.width = `${width}px`;
    };
    fit();
    const observer = container ? new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width === lastWidth) return;
      lastWidth = width;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    }) : null;
    if (container) observer?.observe(container);
    void document.fonts?.ready.then(() => { if (box.isConnected) fit(); });
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); box.style.width = ""; };
  }, [ref, enabled, key]);
}
