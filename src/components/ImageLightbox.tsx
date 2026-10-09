import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, X } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { panBy, RESTING, toggleZoom, wheelFactor, zoomAt, type ZoomBounds, type ZoomView } from "@/lib/image-zoom";

type Image = { src: string; name: string };
/** Opens the gallery from anywhere (reply images): `{ images, index }`. */
export const GALLERY_EVENT = "sirus:open-gallery";

/**
 * Images opened over the app (after MonoCode and T3): dark backdrop, closes on Escape, a
 * backdrop click or ×; with several images, ←/→ and the side arrows move between them.
 * Zoom (after MonoCode): trackpad pinch, ⌘/Ctrl + wheel, + / − / 0, and double click, all
 * around the pointer; zoomed, dragging or scrolling pans. Changing image resets it.
 */
export function ImageLightbox({ images, index = 0, onClose }: { images: Image[] | null; index?: number; onClose: () => void }) {
  const t = useTranslation();
  const reduced = useMotionPreferences();
  const [current, setCurrent] = useState(index);
  const [shown, setShown] = useState(images);
  const [view, setView] = useState<ZoomView>(RESTING);
  const stage = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const pinch = useRef(1);
  const [panning, setPanning] = useState(false);
  if (shown !== images) { setShown(images); setCurrent(index); setView(RESTING); }
  const count = images?.length ?? 0;
  const move = useCallback((step: number) => { setView(RESTING); setCurrent((value) => (value + step + count) % Math.max(count, 1)); }, [count]);
  const bounds = useCallback((): ZoomBounds | null => {
    const box = stage.current?.getBoundingClientRect(), image = picture.current;
    return box && image ? { width: image.offsetWidth, height: image.offsetHeight, viewWidth: box.width, viewHeight: box.height } : null;
  }, []);
  /** A client point relative to the viewport centre, where the unzoomed image rests. */
  const fromCentre = useCallback((clientX: number, clientY: number) => {
    const box = stage.current?.getBoundingClientRect();
    return box ? { x: clientX - box.left - box.width / 2, y: clientY - box.top - box.height / 2 } : { x: 0, y: 0 };
  }, []);
  const zoom = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const limits = bounds(); if (!limits) return;
    const point = clientX === undefined || clientY === undefined ? { x: 0, y: 0 } : fromCentre(clientX, clientY);
    setView((value) => zoomAt(value, factor, point, limits));
  }, [bounds, fromCentre]);
  // Wheel and WebKit's trackpad gestures need non-passive listeners to keep the page still.
  useEffect(() => {
    const node = stage.current;
    if (!node || !images) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const limits = bounds(); if (!limits) return;
      // Pinch arrives as a wheel with ctrlKey; ⌘ + wheel zooms too; otherwise a zoomed image pans.
      if (event.ctrlKey || event.metaKey) zoom(wheelFactor(event.deltaY), event.clientX, event.clientY);
      else setView((value) => panBy(value, -event.deltaX, -event.deltaY, limits));
    };
    type Gesture = Event & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (event: Event) => { event.preventDefault(); pinch.current = 1; };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Gesture;
      zoom(gesture.scale / pinch.current, gesture.clientX, gesture.clientY);
      pinch.current = gesture.scale;
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    node.addEventListener("gesturestart", onGestureStart);
    node.addEventListener("gesturechange", onGestureChange);
    return () => {
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("gesturestart", onGestureStart);
      node.removeEventListener("gesturechange", onGestureChange);
    };
  }, [images, bounds, zoom]);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || view.scale === 1) return;
    drag.current = { x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current, limits = bounds();
    if (!start || !limits) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 3) return;
    if (!start.moved) setPanning(true);
    drag.current = { x: event.clientX, y: event.clientY, moved: true };
    setView((value) => panBy(value, dx, dy, limits));
  };
  useEffect(() => {
    if (!images) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      else if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(1.5); }
      else if (event.key === "-" || event.key === "_") { event.preventDefault(); zoom(1 / 1.5); }
      else if (event.key === "0") { event.preventDefault(); setView(RESTING); }
      else if (count > 1 && (event.key === "ArrowLeft" || event.key === "ArrowRight")) { event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [images, count, move, onClose, zoom]);
  const image = images?.[current];
  return createPortal(<AnimatePresence>
    {image ? <motion.div key="lightbox" className="image-lightbox" role="dialog" aria-modal="true" aria-label={image.name} onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.18 }}>
      <div ref={stage} className="image-lightbox-stage" data-zoomed={view.scale > 1 || undefined} data-dragging={panning || undefined}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { setPanning(false); window.setTimeout(() => { drag.current = null; }, 0); }} onPointerCancel={() => { drag.current = null; setPanning(false); }}
        // A click on the empty stage closes, as on the backdrop; the end of a pan does not.
        onClick={(event) => { event.stopPropagation(); if (!drag.current?.moved && event.target !== picture.current && view.scale === 1) onClose(); }}
        onDoubleClick={(event) => { event.stopPropagation(); const limits = bounds(); if (limits) setView((value) => toggleZoom(value, fromCentre(event.clientX, event.clientY), limits)); }}>
        <div className="image-lightbox-zoom" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          <motion.img ref={picture} key={image.src} src={image.src} alt={image.name} className="image-lightbox-image" draggable={false} onClick={(event) => event.stopPropagation()}
            initial={reduced ? false : { scale: 0.96, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }} />
        </div>
      </div>
      {count > 1 ? <>
        <button type="button" className="image-lightbox-nav image-lightbox-prev" aria-label={t("gallery.previous")} onClick={(event) => { event.stopPropagation(); move(-1); }}><ChevronLeft size={18} aria-hidden="true" /></button>
        <button type="button" className="image-lightbox-nav image-lightbox-next" aria-label={t("gallery.next")} onClick={(event) => { event.stopPropagation(); move(1); }}><ChevronRight size={18} aria-hidden="true" /></button>
        <span className="image-lightbox-count">{current + 1} / {count}</span>
      </> : null}
      <button type="button" className="image-lightbox-close" aria-label={t("common.close")} onClick={onClose}><X size={16} aria-hidden="true" /></button>
    </motion.div> : null}
  </AnimatePresence>, document.body);
}

/** One gallery for the app: reply images dispatch GALLERY_EVENT and it opens here. */
export function ImageGalleryHost() {
  const [gallery, setGallery] = useState<{ images: Image[]; index: number } | null>(null);
  useEffect(() => {
    const open = (event: Event) => setGallery((event as CustomEvent<{ images: Image[]; index: number }>).detail);
    window.addEventListener(GALLERY_EVENT, open);
    return () => window.removeEventListener(GALLERY_EVENT, open);
  }, []);
  const close = useCallback(() => setGallery(null), []);
  return <ImageLightbox images={gallery?.images ?? null} index={gallery?.index ?? 0} onClose={close} />;
}
