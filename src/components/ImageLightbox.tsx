import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, X } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { useMotionPreferences } from "@/lib/use-motion-preferences";

type Image = { src: string; name: string };
/** Opens the gallery from anywhere (reply images): `{ images, index }`. */
export const GALLERY_EVENT = "sirus:open-gallery";

/**
 * Images opened over the app (after MonoCode and T3): dark backdrop, closes on Escape, a
 * backdrop click or ×; with several images, ←/→ and the side arrows move between them.
 */
export function ImageLightbox({ images, index = 0, onClose }: { images: Image[] | null; index?: number; onClose: () => void }) {
  const t = useTranslation();
  const reduced = useMotionPreferences();
  const [current, setCurrent] = useState(index);
  const [shown, setShown] = useState(images);
  if (shown !== images) { setShown(images); setCurrent(index); }
  const count = images?.length ?? 0;
  const move = useCallback((step: number) => setCurrent((value) => (value + step + count) % Math.max(count, 1)), [count]);
  useEffect(() => {
    if (!images) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      else if (count > 1 && (event.key === "ArrowLeft" || event.key === "ArrowRight")) { event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [images, count, move, onClose]);
  const image = images?.[current];
  return createPortal(<AnimatePresence>
    {image ? <motion.div key="lightbox" className="image-lightbox" role="dialog" aria-modal="true" aria-label={image.name} onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.18 }}>
      <motion.img key={image.src} src={image.src} alt={image.name} className="image-lightbox-image" draggable={false} onClick={(event) => event.stopPropagation()}
        initial={reduced ? false : { scale: 0.96, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }} />
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
