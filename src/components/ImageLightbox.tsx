import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { useMotionPreferences } from "@/lib/use-motion-preferences";

/** A sent image opened over the app (after MonoCode): dark backdrop, close on Escape, backdrop click or ×. */
export function ImageLightbox({ image, onClose }: { image: { src: string; name: string } | null; onClose: () => void }) {
  const t = useTranslation();
  const reduced = useMotionPreferences();
  useEffect(() => {
    if (!image) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [image, onClose]);
  return createPortal(<AnimatePresence>
    {image ? <motion.div key="lightbox" className="image-lightbox" role="dialog" aria-modal="true" aria-label={image.name} onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.18 }}>
      <motion.img src={image.src} alt={image.name} className="image-lightbox-image" draggable={false} onClick={(event) => event.stopPropagation()}
        initial={reduced ? false : { scale: 0.96 }} animate={{ scale: 1 }} exit={reduced ? undefined : { scale: 0.98 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }} />
      <button type="button" className="image-lightbox-close" aria-label={t("common.close")} onClick={onClose}><X size={16} aria-hidden="true" /></button>
    </motion.div> : null}
  </AnimatePresence>, document.body);
}
