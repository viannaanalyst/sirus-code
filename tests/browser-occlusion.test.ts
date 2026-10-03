import { test } from "node:test";
import assert from "node:assert/strict";
import { overlapsBrowser } from "../src/lib/browser-occlusion.ts";

test("a narrow rail popup hides native browser even when every old hit-test point misses it", () => {
  const viewport = { left: 52, top: 80, right: 1440, bottom: 900 };
  const popup = { left: 60, top: 48, right: 380, bottom: 892 };
  for (const [fx, fy] of [[.5, .5], [.25, .25], [.75, .25], [.25, .75], [.75, .75]]) {
    const x = viewport.left + (viewport.right - viewport.left) * fx;
    const y = viewport.top + (viewport.bottom - viewport.top) * fy;
    assert.ok(x > popup.right || y < popup.top || y > popup.bottom);
  }
  assert.equal(overlapsBrowser(viewport, popup), true);
});

test("hidden/empty or adjacent popup geometry does not cover a browser viewport", () => {
  const viewport = { left: 400, top: 80, right: 1000, bottom: 900 };
  assert.equal(overlapsBrowser(viewport, { left: 60, top: 48, right: 380, bottom: 892 }), false);
  assert.equal(overlapsBrowser(viewport, { left: 400, top: 80, right: 400, bottom: 900 }), false);
  assert.equal(overlapsBrowser(viewport, { left: 300, top: 80, right: 400, bottom: 900 }), false);
  assert.equal(overlapsBrowser(viewport, { left: 600, top: 80, right: 700, bottom: 200 }), true);
});
