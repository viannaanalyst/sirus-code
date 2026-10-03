import { useReducedMotion } from "motion/react";
import { useAppStore } from "@/store/app-store";
export function useMotionPreferences() {
  const osReduced = useReducedMotion();
  const animations = useAppStore((state) => state.settings.animations);
  const reduceMotion = useAppStore((state) => state.settings.reduceMotion);
  return Boolean(osReduced || reduceMotion || !animations);
}
