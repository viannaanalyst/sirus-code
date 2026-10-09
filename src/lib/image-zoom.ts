/**
 * Lightbox zoom (after MonoCode): a scale and a pan, with the point under the cursor kept
 * still while zooming. Coordinates are relative to the centre of the viewport, where the
 * image rests unzoomed.
 */
export interface ZoomView { scale: number; x: number; y: number }
export interface ZoomBounds { width: number; height: number; viewWidth: number; viewHeight: number }

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
export const RESTING: ZoomView = { scale: 1, x: 0, y: 0 };

/** Keeps the zoomed image covering the viewport where it can; a smaller side stays centred. */
export function clampPan(view: ZoomView, bounds: ZoomBounds): ZoomView {
  const limit = (size: number, viewSize: number) => Math.max(0, (size * view.scale - viewSize) / 2);
  const lx = limit(bounds.width, bounds.viewWidth), ly = limit(bounds.height, bounds.viewHeight);
  return { scale: view.scale, x: Math.min(lx, Math.max(-lx, view.x)) || 0, y: Math.min(ly, Math.max(-ly, view.y)) || 0 };
}

/** Zooms by `factor` around `point` (relative to the viewport centre). */
export function zoomAt(view: ZoomView, factor: number, point: { x: number; y: number }, bounds: ZoomBounds): ZoomView {
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.scale * factor));
  if (scale === MIN_ZOOM) return RESTING;
  const ratio = scale / view.scale;
  return clampPan({ scale, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio }, bounds);
}

export function panBy(view: ZoomView, dx: number, dy: number, bounds: ZoomBounds): ZoomView {
  return view.scale === 1 ? view : clampPan({ ...view, x: view.x + dx, y: view.y + dy }, bounds);
}

/** Double click: 2.5× at the point, or back to rest when already zoomed. */
export function toggleZoom(view: ZoomView, point: { x: number; y: number }, bounds: ZoomBounds): ZoomView {
  return view.scale > 1 ? RESTING : zoomAt(view, 2.5, point, bounds);
}

/** Wheel delta to a zoom factor; pinch deltas are small, so they scale smoothly. */
export function wheelFactor(deltaY: number): number {
  return Math.exp(-Math.max(-50, Math.min(50, deltaY)) * 0.01);
}
