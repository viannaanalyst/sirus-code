import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCssColor, terminalSurface } from "../src/lib/terminal-surface.ts";

test("computed colours parse in both rgb syntaxes", () => {
  assert.deepEqual(parseCssColor("rgb(17, 17, 17)"), { r: 17, g: 17, b: 17, a: 1 });
  assert.deepEqual(parseCssColor("rgba(17, 17, 17, 0.5)"), { r: 17, g: 17, b: 17, a: 0.5 });
  assert.deepEqual(parseCssColor("rgb(17 17 17 / 40%)"), { r: 17, g: 17, b: 17, a: 0.4 });
  assert.equal(parseCssColor("color(display-p3 1 0 0)"), null);
});

test("the terminal takes the first painted surface around it", () => {
  // The dock beside a started conversation: sidebar material, opaque.
  assert.deepEqual(terminalSurface(["rgba(0, 0, 0, 0)", "rgb(17, 17, 17)", "rgb(12, 12, 12)"], "#0c0c0c"), { background: "#111111", transparent: false });
  // Translucent sidebar material: composed over, with the tint kept at zero alpha.
  assert.deepEqual(terminalSurface(["rgba(17, 17, 17, 0.72)"], "#0c0c0c"), { background: "#11111100", transparent: true });
  assert.deepEqual(terminalSurface([], "#0c0c0c"), { background: "#0c0c0c", transparent: false });
  assert.deepEqual(terminalSurface(["rgba(0, 0, 0, 0)"], "#0c0c0c00"), { background: "#0c0c0c00", transparent: true });
});
