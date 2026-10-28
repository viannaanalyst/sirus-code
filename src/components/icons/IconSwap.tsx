import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { motionTokens } from "@/lib/motion";
import { useMotionPreferences } from "@/lib/use-motion-preferences";

/**
 * Shows one icon at a time. When `id` changes, the old glyph shrinks and blurs out while the new
 * one grows in over the same cell, so the button keeps its size (ADR-171). With reduced motion,
 * animations off, or the app's reduce-motion setting, the swap is instant.
 */
export function IconSwap({ id, children }: { id: string; children: ReactNode }) {
  const reduced = useMotionPreferences();
  return <span className="relative inline-grid place-items-center">
    <AnimatePresence initial={false}>
      <motion.span key={id} className="col-start-1 row-start-1 inline-flex"
        initial={reduced ? false : { opacity: 0, scale: 0.6, filter: "blur(2px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.6, filter: "blur(2px)" }}
        transition={reduced ? { duration: 0 } : { duration: motionTokens.fast, ease: motionTokens.ease }}>
        {children}
      </motion.span>
    </AnimatePresence>
  </span>;
}
