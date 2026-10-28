/**
 * Which rows of the agent activity tree play their entrance (ADR-176). Rows already there when the
 * tree mounted, or present when a transcript loads, render still; only rows that arrive afterwards
 * during a live turn reveal, the first after a short lead and the others staggered.
 */
export const TREE_REVEAL_LEAD_MS = 90;
export const TREE_REVEAL_STAGGER_MS = 65;
/** Rows arriving together past this position share its delay, so a burst never waits long. */
export const TREE_REVEAL_CAP = 8;

/**
 * Records every id not yet known: `null` when it must appear still, otherwise its reveal delay in ms.
 * `animate` is false for the first pass (the rows that were already there) and for turns that are over.
 * Ids already known keep their value, so a re-render never restarts or cuts an entrance.
 */
export function assignReveals(known: Map<string, number | null>, ids: readonly string[], animate: boolean): void {
  let arrival = 0;
  for (const id of ids) {
    if (known.has(id)) continue;
    known.set(id, animate ? TREE_REVEAL_LEAD_MS + Math.min(arrival, TREE_REVEAL_CAP) * TREE_REVEAL_STAGGER_MS : null);
    arrival += 1;
  }
}

/** A sentence split around its detail ("Ran ", "npm test", ""), so the command or path can be set in mono. */
export function splitAroundDetail(sentence: string, detail: string): [string, string, string] {
  const at = detail ? sentence.indexOf(detail) : -1;
  return at < 0 ? [sentence, "", ""] : [sentence.slice(0, at), detail, sentence.slice(at + detail.length)];
}
