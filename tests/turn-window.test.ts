import { test } from "node:test";
import assert from "node:assert/strict";
import { FIRST_PAINT_TURNS, INITIAL_TURNS, TURN_PAGE_SIZE, nextTurnCount, prependedScrollTop, turnStarts, turnsToReveal, windowStart } from "../src/lib/turn-window.ts";

const roles = (pattern: string) => [...pattern].map(letter => ({ role: letter === "u" ? "user" : letter === "s" ? "system" : "agent" }));

test("a turn starts at each person's message; anything before the first joins the first turn", () => {
  assert.deepEqual(turnStarts(roles("uauaau")), [0, 2, 5]);
  assert.deepEqual(turnStarts(roles("aauau")), [0, 2, 4]);
  assert.deepEqual(turnStarts([]), []);
});

test("the window starts at the first message of the last N turns", () => {
  const starts = turnStarts(roles("uauauaua"));
  assert.equal(windowStart(starts, 1), 6);
  assert.equal(windowStart(starts, 3), 2);
  assert.equal(windowStart(starts, 10), 0, "a window larger than the conversation shows it all");
  assert.equal(windowStart(starts, 0), 6, "the latest turn is always shown");
  assert.equal(windowStart([], FIRST_PAINT_TURNS), 0);
});

test("revealing a message widens the window to its turn", () => {
  const starts = turnStarts(roles("uauauaua"));
  assert.equal(turnsToReveal(starts, 7), 1);
  assert.equal(turnsToReveal(starts, 6), 1);
  assert.equal(turnsToReveal(starts, 5), 2);
  assert.equal(turnsToReveal(starts, 0), 4);
  assert.equal(turnsToReveal(starts, -1), 0, "an unknown message needs nothing");
  // Revealed then shown: the message falls inside the window.
  for (let index = 0; index < 8; index++) assert.ok(windowStart(starts, turnsToReveal(starts, index)) <= index);
});

test("earlier pages add a page at a time and stop at the first turn", () => {
  assert.equal(nextTurnCount(INITIAL_TURNS, 100), INITIAL_TURNS + TURN_PAGE_SIZE);
  assert.equal(nextTurnCount(INITIAL_TURNS, 30), 30);
  assert.equal(nextTurnCount(40, 30), 40, "a window already past the start does not shrink");
});

test("added turns above move the scroll position by their height", () => {
  assert.equal(prependedScrollTop(120, 40, 1640), 1720);
  assert.equal(prependedScrollTop(0, 40, 40), 0);
  assert.equal(prependedScrollTop(10, 500, 100), 0, "never negative");
});
