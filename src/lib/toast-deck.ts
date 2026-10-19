/**
 * Where each toast of the top-right deck sits (newest first). Collapsed, the newest is in
 * front and the next two peek out below it, each a little smaller and fainter; the rest hide
 * behind. Expanded (pointer or focus on the deck), they fan out into a list with a gap.
 */
export const DECK_PEEK = 10;
export const DECK_GAP = 8;
const DECK_SHOWN = 3;
const DECK_SHRINK = 0.05;

export interface DeckPlace { y: number; scale: number; opacity: number; interactive: boolean }

export function deckLayout(heights: readonly number[], expanded: boolean): { items: DeckPlace[]; height: number } {
  if (!heights.length) return { items: [], height: 0 };
  if (expanded) {
    let y = 0;
    const items = heights.map(height => { const place = { y, scale: 1, opacity: 1, interactive: true }; y += height + DECK_GAP; return place; });
    return { items, height: y - DECK_GAP };
  }
  const items = heights.map((_, depth) => ({
    // Items behind the front one are shorter; align their bottoms to peek below it.
    y: depth === 0 ? 0 : heights[0] - heights[depth] * (1 - depth * DECK_SHRINK) + Math.min(depth, DECK_SHOWN - 1) * DECK_PEEK,
    scale: 1 - Math.min(depth, DECK_SHOWN) * DECK_SHRINK,
    opacity: depth < DECK_SHOWN ? 1 - depth * 0.18 : 0,
    interactive: depth === 0,
  }));
  return { items, height: heights[0] + Math.min(heights.length - 1, DECK_SHOWN - 1) * DECK_PEEK };
}
