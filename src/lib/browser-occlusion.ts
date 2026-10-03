export interface ViewportRect { left: number; top: number; right: number; bottom: number; }
/** Native views cannot be stacked underneath a DOM portal, even at a narrow edge. */
export function overlapsBrowser(viewport: ViewportRect, overlay: ViewportRect): boolean {
  return overlay.right > overlay.left && overlay.bottom > overlay.top
    && viewport.left < overlay.right && viewport.right > overlay.left
    && viewport.top < overlay.bottom && viewport.bottom > overlay.top;
}
