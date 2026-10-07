import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { client } from "@/client";
import { useTranslation } from "@/i18n/use-translation";
import { motionTokens } from "@/lib/motion";
import "@/styles/quit-toast.css";

/**
 * "Press ⌘Q again to quit" (ADR-090): shown after the first ⌘Q when no agent is
 * running; its ring empties over the window in which a second press quits.
 */
export function QuitToast() {
  const t = useTranslation();
  const [armed, setArmed] = useState<{ key: number; ms: number } | null>(null);
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void client.onQuitArmed((ms) => setArmed({ key: Date.now(), ms })).then((unlisten) => { if (cancelled) unlisten(); else stop = unlisten; });
    return () => { cancelled = true; stop?.(); };
  }, []);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(null), armed.ms);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return <AnimatePresence>
    {armed ? <motion.div key={armed.key} role="status" className="quit-toast floating-material"
      initial={{ opacity: 0, y: -8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: motionTokens.fast, ease: motionTokens.ease }}>
      <svg className="quit-toast-ring" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6.5" className="quit-toast-track" />
        <circle cx="8" cy="8" r="6.5" className="quit-toast-time" style={{ animationDuration: `${armed.ms}ms` }} />
      </svg>
      <span>{t("Press")} <kbd>⌘Q</kbd> {t("again to quit")}</span>
    </motion.div> : null}
  </AnimatePresence>;
}
