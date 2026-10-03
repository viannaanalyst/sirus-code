export const motionTokens = {
  instant: 0.08,
  fast: 0.14,
  normal: 0.2,
  slow: 0.32,
  reveal: 0.64,
  ease: [0.16, 1, 0.3, 1] as const,
};

export const reducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const pressScale = reducedMotion ? 1 : 0.98;
