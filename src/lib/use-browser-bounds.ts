import { overlapsBrowser } from "./browser-occlusion";
import { useEffect, type RefObject } from "react";
import type { BrowserBounds } from "@/client/types";
import { useAppStore } from "@/store/app-store";

const BURST_FRAMES = 6;
const HIT_POINTS: [number, number][] = [
  [0.5, 0.5],
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
];

/**
 * Measures the viewport and streams deduplicated logical bounds to the native
 * view. WKWebView paints above the DOM, so the view is hidden the moment a
 * dialog, menu or any other portal covers the pane.
 */
export function useBrowserBounds(
  sessionId: string,
  viewport: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  const setBrowserBounds = useAppStore((state) => state.setBrowserBounds);
  useEffect(() => {
    const node = viewport.current;
    if (!sessionId || !node || !enabled) return;
    const overlays = new Set<Element>();
    const send = () => {
      if (document.hidden || !node.isConnected) {
        setBrowserBounds(sessionId, null);
        return;
      }
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        setBrowserBounds(sessionId, null);
        return;
      }
      const floating = [...document.querySelectorAll<HTMLElement>("[data-appearance-floating]")];
      for (const overlay of overlays) {
        if (!floating.includes(overlay as HTMLElement)) { resize.unobserve(overlay); overlays.delete(overlay); }
      }
      for (const overlay of floating) {
        if (!overlays.has(overlay) ) { overlays.add(overlay); resize.observe(overlay); }
      }
      const portalCovered = floating.some(overlay => {
        if (node.contains(overlay)) return false;
        const style = getComputedStyle(overlay);
        return style.display !== "none" && style.visibility !== "hidden" && overlapsBrowser(rect, overlay.getBoundingClientRect());
      });
      const covered = portalCovered || HIT_POINTS.some(([fx, fy]) => {
        const top = document.elementFromPoint(
          rect.left + rect.width * fx,
          rect.top + rect.height * fy,
        );
        return !top || !node.contains(top);
      });
      if (covered) {
        setBrowserBounds(sessionId, null);
        return;
      }
      setBrowserBounds(sessionId, {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      } satisfies BrowserBounds);
    };
    const resize = new ResizeObserver(send);
    resize.observe(node);
    send();
    let frames = BURST_FRAMES;
    let raf = 0;
    const burst = () => {
      send();
      if (frames-- > 0) raf = requestAnimationFrame(burst);
    };
    raf = requestAnimationFrame(burst);
    // Portals mount at body level. Measure a short burst after insertion so
    // Radix positioning is included, without observing streamed chat text.
    const portals = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      frames = BURST_FRAMES;
      burst();
    });
    portals.observe(document.body, { childList: true });
    const onVisibility = () => send();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", send);
    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      portals.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", send);
      setBrowserBounds(sessionId, null);
    };
  }, [sessionId, viewport, enabled, setBrowserBounds]);
}
