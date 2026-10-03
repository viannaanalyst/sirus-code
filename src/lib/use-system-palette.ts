import { useSyncExternalStore } from "react";

function query() { return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null; }
export function readSystemPalette(): "dark" | "light" { const media = query(); return !media || media.matches ? "dark" : "light"; }
export function subscribeSystemPalette(onChange: () => void) {
  const media = query();
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
}
export function useSystemPalette() { return useSyncExternalStore(subscribeSystemPalette, readSystemPalette, () => "dark" as const); }
