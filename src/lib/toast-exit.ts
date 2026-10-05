/** How long a dismissed toast keeps its card mounted so its exit animation can play. */
export const TOAST_EXIT_MS = 260;

/** Clears a toast's data only after its exit animation, never while it is still leaving. */
export function afterToastExit(clear: () => void) {
  window.setTimeout(clear, TOAST_EXIT_MS);
}
