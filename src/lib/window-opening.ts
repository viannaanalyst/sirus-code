/**
 * The main window's opening (ADR-098). The native window starts hidden and already in its
 * glass look; on the first ready paint the app asks Rust to show it, then the content is
 * wiped in from the left edge while the rail, header and main area slide in after it.
 * The motion itself is CSS (src/styles/opening.css); this only drives `html[data-opening]`:
 * "pending" from boot, "showing" while the native window is asked to appear, "play" once it
 * is visible, removed when the reveal ends.
 */

export type OpeningPhase = "pending" | "showing" | "play";

/** The wipe (550 ms) and the last piece (140 ms delay + 450 ms) end inside this, with a frame to spare. */
export const OPENING_MS = 620;
/** Reduced motion: a quick fade only. */
export const OPENING_REDUCED_MS = 170;

type OpeningRoot = { dataset: DOMStringMap };

/** How long `data-opening="play"` stays before it is cleared. */
export function openingDuration(reduced: boolean) {
  return reduced ? OPENING_REDUCED_MS : OPENING_MS;
}

/** The app's own motion switches and the system's reduced-motion preference. */
export function openingReduced(dataset: DOMStringMap, prefersReduced: boolean) {
  return prefersReduced || dataset.animations === "off" || dataset.reduceMotion === "on";
}

/** Marks the boot of the native main window; the root stays hidden until the reveal plays. */
export function beginWindowOpening(root: OpeningRoot = document.documentElement) {
  root.dataset.opening = "pending" satisfies OpeningPhase;
}

/** Ends the opening at once, e.g. when the fatal panel replaces the app. */
export function endWindowOpening(root: OpeningRoot = document.documentElement) {
  delete root.dataset.opening;
}

/**
 * Called on the first ready paint. Shows the native window (`showWindow` resolves once it is
 * on screen, or fails harmlessly) and then plays the reveal once. A no-op when the opening
 * was never begun (phone, browser and the floating Astro window).
 */
export function playWindowOpening(
  showWindow: () => Promise<unknown>,
  root: OpeningRoot = document.documentElement,
  prefersReduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  schedule: (run: () => void, ms: number) => unknown = setTimeout,
) {
  if (root.dataset.opening !== "pending") return Promise.resolve(false);
  // Claimed synchronously so a second ready signal never plays it twice.
  root.dataset.opening = "showing" satisfies OpeningPhase;
  return showWindow().catch(() => undefined).then(() => {
    if (root.dataset.opening !== "showing") return false;
    root.dataset.opening = "play" satisfies OpeningPhase;
    schedule(() => { if (root.dataset.opening === "play") endWindowOpening(root); }, openingDuration(openingReduced(root.dataset, prefersReduced)));
    return true;
  });
}
