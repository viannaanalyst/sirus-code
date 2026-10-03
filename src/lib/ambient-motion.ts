import { useSyncExternalStore } from "react";

/**
 * One shared gate for decorative loops (composer rim, landing orbits, waiting
 * orbit): they only run while the window has focus, the document is visible
 * and no full-page surface (Settings) covers them.
 *
 * Focus is tracked from window focus/blur events from the moment this module
 * loads. `document.hasFocus()` is not used: WKWebView can report false while
 * the app mounts and then never send a focus event for a window that was
 * already key, which would leave the decoration paused while in use.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
let covered = false;
let focused = true;

const emit = () => { for (const listener of [...listeners]) listener(); };

// Test and server environments may lack a window.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("focus", () => { focused = true; emit(); });
  window.addEventListener("blur", () => { focused = false; emit(); });
  document.addEventListener("visibilitychange", emit);
}

export function ambientActive() {
  return focused && !covered && !(typeof document !== "undefined" && document.hidden);
}

/** A full-page surface hides the decorative loops underneath it. */
export function setAmbientCovered(value: boolean) {
  if (covered === value) return;
  covered = value;
  emit();
}

export function subscribeAmbient(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useAmbientActive() {
  return useSyncExternalStore(subscribeAmbient, ambientActive, () => true);
}
