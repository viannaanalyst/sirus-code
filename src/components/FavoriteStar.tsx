import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { Star } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { motionTokens } from "@/lib/motion";

export function FavoriteStar({
  favorite,
  onToggle,
  alwaysVisible,
  label,
}: {
  favorite: boolean;
  onToggle: () => void;
  alwaysVisible?: boolean;
  label: string;
}) {
  const reducedMotion = useMotionPreferences();
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={favorite}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-[6px] text-text-muted hover:text-text-primary",
        !favorite && !alwaysVisible && "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100",
        favorite && "opacity-100 text-text-primary",
      )}
    >
      <motion.span
        key={favorite ? "on" : "off"}
        initial={reducedMotion ? false : { scale: 0.85, opacity: 0.6, rotate: favorite ? -12 : 0 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ duration: motionTokens.fast, ease: motionTokens.ease }}
      >
        <Star size={13} fill={favorite ? "currentColor" : "none"} />
      </motion.span>
    </button>
  );
}
