import { test } from "node:test";
import assert from "node:assert/strict";
import { asciiChar, ditherChannel, luminance } from "../src/lib/background-effects.ts";

test("background effects map light to dither levels and characters", () => {
  assert.equal(ditherChannel(0, 0, 0), 0);
  assert.equal(ditherChannel(255, 3, 3), 255);
  // A mid grey becomes a mix of neighbouring levels across the Bayer cell.
  const levels = new Set(Array.from({ length: 16 }, (_, index) => ditherChannel(128, index % 4, Math.floor(index / 4))));
  assert.ok(levels.size >= 2 && [...levels].every((value) => value === 85 || value === 170));
  assert.equal(asciiChar(0), " ");
  assert.equal(asciiChar(1), "@");
  assert.ok(Math.abs(luminance(255, 255, 255) - 1) < 1e-9);
});
