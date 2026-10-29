import { overlapsBrowser } from "./browser-occlusion";
import { useEffect, useState, type RefObject } from "react";
import { client } from "@/client";
import type { BrowserBounds } from "@/client/types";
import { useAppStore } from "@/store/app-store";

const BURST_FRAMES = 6;
/** How long the still stays after the page is shown again, while the native view returns. */
const STILL_LINGER_MS = 160;
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
 * dialog, menu or any other portal covers the pane. While it is covered, the pane
 * shows a still of the page (a JPEG data URL, returned here) instead of an empty frame.
 */
export function useBrowserBounds(
  sessionId: string,
  viewport: RefObject<HTMLElement | null>,
  enabled: boolean,
  tabId: string | null = null,
) {
  const setBrowserBounds = useAppStore((state) => state.setBrowserBounds);
  const [still, setStill] = useState<string | null>(null);
  useEffect(() => {
    const node = viewport.current;
    if (!sessionId || !node || !enabled) return;
    const overlays = new Set<Element>();
    // "shown" while the native view is on screen; a cover after it asks once for a still.
    let state: "shown" | "covered" | "off" = "off";
    let request = 0;
    const settle = (next: typeof state, rect?: DOMRect) => {
      if (next === state) return;
      const was = state;
      state = next;
      if (next !== "covered") {
        // The native view comes back a beat after this call: keep the still until it has.
        const ticket = ++request;
        if (next === "off") setStill(null);
        else window.setTimeout(() => { if (ticket === request) setStill(null); }, STILL_LINGER_MS);
        return;
      }
      if (was !== "shown" || !tabId || !rect) return;
      const ticket = ++request;
      void client.browserFrame(sessionId, tabId, Math.ceil(rect.width)).then((jpeg) => {
        if (ticket === request && state === "covered") setStill(`data:image/jpeg;base64,${jpeg}`);
      }).catch(() => undefined);
    };
    const send = () => {
      if (document.hidden || !node.isConnected) {
        settle("off");
        setBrowserBounds(sessionId, null);
        return;
      }
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        settle("off");
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
        settle("covered", rect);
        setBrowserBounds(sessionId, null);
        return;
      }
      settle("shown");
      setBrowserBounds(sessionId, {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      } satisfies BrowserBounds);
    };
    const resize = new ResizeObserver(send);
    resize.observe(node);
    // A centred device frame moves when its pane resizes, even at the same size (ADR-111).
    if (node.parentElement) resize.observe(node.parentElement);
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
      request += 1;
      setStill(null);
      setBrowserBounds(sessionId, null);
    };
  }, [sessionId, viewport, enabled, tabId, setBrowserBounds]);
  return still;
}
