import type { TabStatus } from "@/lib/header-tabs";

/** What the right corner of a conversation under a project says (ADR-175): the person's own signals, in words. */
export type RowStatus = "working" | "needsYou" | "done";

/**
 * Maps the row's tab status to its corner label. Finished and unseen reads "done" only while the
 * conversation is not the one open (looking at it counts as seen); idle has no label, so the age shows.
 */
export function rowStatus(status: TabStatus, active: boolean): RowStatus | null {
  if (status === "waiting") return "needsYou";
  if (status === "running") return "working";
  return status === "done" && !active ? "done" : null;
}

/** The ring order of the 2x3 pixel spinner's cells (row-major index), clockwise: [[0,1],[5,2],[4,3]]. */
export const PIXEL_RING = [0, 1, 5, 2, 4, 3] as const;

/** Each cell's position along the ring (0 to 5), in row-major order, which sets its animation delay. */
export function pixelRingPositions(): number[] {
  const positions = new Array<number>(PIXEL_RING.length);
  PIXEL_RING.forEach((cell, step) => { positions[cell] = step; });
  return positions;
}
