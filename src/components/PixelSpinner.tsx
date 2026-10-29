import type { CSSProperties } from "react";
import { pixelRingPositions } from "@/lib/conversation-row-status";

const POSITIONS = pixelRingPositions();

/** A 2x3 grid of 2px cells where a light runs clockwise around the ring (credit: Zeron). Tinted by the text colour; styles in conversation-sidebar.css. */
export function PixelSpinner() {
  return <span className="pixel-spinner" aria-hidden="true">
    {POSITIONS.map((step, cell) => <i key={cell} style={{ "--step": step } as CSSProperties} />)}
  </span>;
}
