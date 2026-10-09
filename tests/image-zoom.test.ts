import assert from "node:assert/strict";
import { test } from "node:test";
import { clampPan, panBy, RESTING, toggleZoom, wheelFactor, zoomAt } from "../src/lib/image-zoom.ts";

const bounds = { width: 800, height: 600, viewWidth: 1000, viewHeight: 700 };

test("zooming keeps the point under the cursor still and stays within 1–8×", () => {
  const point = { x: 200, y: -100 };
  const view = zoomAt(RESTING, 2, point, bounds);
  assert.equal(view.scale, 2);
  // Image point under the cursor before: (point - 0) / 1; after: (point - pan) / 2 — the same.
  assert.deepEqual({ x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale }, point);
  assert.equal(zoomAt(view, 100, point, bounds).scale, 8);
  assert.deepEqual(zoomAt(view, 0.1, point, bounds), RESTING);
});

test("panning never shows past the image edges and does nothing at rest", () => {
  assert.deepEqual(panBy(RESTING, 50, 50, bounds), RESTING);
  const zoomed = { scale: 2, x: 0, y: 0 };
  assert.deepEqual(panBy(zoomed, 9999, -9999, bounds), { scale: 2, x: 300, y: -250 });
  assert.deepEqual(clampPan({ scale: 1.1, x: 40, y: 40 }, bounds), { scale: 1.1, x: 0, y: 0 });
});

test("double click zooms in at the point and back out; wheel deltas map to bounded factors", () => {
  const zoomed = toggleZoom(RESTING, { x: 0, y: 0 }, bounds);
  assert.equal(zoomed.scale, 2.5);
  assert.deepEqual(toggleZoom(zoomed, { x: 10, y: 10 }, bounds), RESTING);
  assert.ok(wheelFactor(-10) > 1 && wheelFactor(10) < 1);
  assert.equal(wheelFactor(-1000), wheelFactor(-50));
});
