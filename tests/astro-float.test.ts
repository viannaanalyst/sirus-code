import { test } from "node:test";
import assert from "node:assert/strict";
import { ASTRO_FLOAT_RAIL_BREAKPOINT, astroFloatCurrent, astroFloatRailMode } from "../src/lib/astro-float.ts";

test("the float rail sits beside the chat when wide and behind a toggle when narrow", () => {
  assert.equal(astroFloatRailMode(480), "beside");
  assert.equal(astroFloatRailMode(ASTRO_FLOAT_RAIL_BREAKPOINT), "beside");
  assert.equal(astroFloatRailMode(ASTRO_FLOAT_RAIL_BREAKPOINT - 1), "toggle");
  assert.equal(astroFloatRailMode(340), "toggle");
});

test("the float keeps its Astro while it exists and falls back to the first after a delete", () => {
  assert.equal(astroFloatCurrent("b", null), "b");
  assert.equal(astroFloatCurrent("b", [{ id: "a" }, { id: "b" }]), "b");
  assert.equal(astroFloatCurrent("gone", [{ id: "a" }, { id: "b" }]), "a");
  assert.equal(astroFloatCurrent("gone", []), "gone");
});
