import { useContext } from "react";
import { MotionConfigContext, useReducedMotion } from "motion/react";
/** Arc respects the host's live animation setting as well as the OS preference. */
export function useArcReducedMotion() {
  const preference = useReducedMotion();
  const config = useContext(MotionConfigContext);
  return config.reducedMotion === "always" || Boolean(preference);
}
