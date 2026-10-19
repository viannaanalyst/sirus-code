import assert from "node:assert/strict";
import { test } from "node:test";
import { DECK_GAP, DECK_PEEK, deckLayout } from "../src/lib/toast-deck.ts";

test("toast deck: collapsed, the newest in front and two peeking; expanded, a list", () => {
  assert.deepEqual(deckLayout([], false), { items: [], height: 0 });
  const collapsed = deckLayout([60, 60, 60, 60], false);
  assert.equal(collapsed.items[0].y, 0);
  assert.equal(collapsed.items[0].interactive, true);
  assert.ok(collapsed.items.slice(1).every(item => !item.interactive));
  // The second card's bottom shows DECK_PEEK below the front one.
  const second = collapsed.items[1];
  assert.ok(Math.abs(second.y + 60 * second.scale - (60 + DECK_PEEK)) < 1e-9);
  assert.equal(collapsed.items[3].opacity, 0);
  assert.equal(collapsed.height, 60 + 2 * DECK_PEEK);
  const expanded = deckLayout([60, 40, 50], true);
  assert.deepEqual(expanded.items.map(item => item.y), [0, 60 + DECK_GAP, 100 + 2 * DECK_GAP]);
  assert.equal(expanded.height, 150 + 2 * DECK_GAP);
});
