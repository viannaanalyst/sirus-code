import { test } from "node:test";
import assert from "node:assert/strict";
import { agentPageShows, clampPlayerPosition, cornerPosition, miniPlayerSize, nearestCorner } from "../src/lib/mini-player.ts";
import { annotationCropRect, annotationText, base64Text } from "../src/lib/browser-annotation.ts";
import { isPreviewUrlValid } from "../src/lib/preview-url.ts";
import { mergeLocalServers, scanLocalServers, urlPort, type NativeLocalServer } from "../src/lib/local-servers.ts";

const wide = { width: 900, height: 700 };

test("the player keeps 360 by 240 in a roomy conversation and shrinks to fit a narrow one", () => {
  assert.deepEqual(miniPlayerSize(wide, 0), { width: 360, height: 240 });
  const narrow = miniPlayerSize({ width: 300, height: 700 }, 0);
  assert.equal(narrow.width, 276);
  assert.equal(narrow.height, Math.round(276 * 240 / 360));
  const short = miniPlayerSize({ width: 900, height: 260 }, 120);
  assert.ok(short.height <= 260 - 24 - 120);
});

test("corners sit inside the margins and above the composer inset", () => {
  const player = { width: 360, height: 240 };
  assert.deepEqual(cornerPosition("top-left", wide, player), { x: 12, y: 12 });
  assert.deepEqual(cornerPosition("bottom-right", wide, player), { x: 900 - 360 - 12, y: 700 - 240 - 12 });
  assert.equal(cornerPosition("bottom-left", wide, player, 120).y, 700 - 240 - 12 - 120);
});

test("a dragged player is clamped to the container and snaps to its nearest corner", () => {
  const player = { width: 360, height: 240 };
  assert.deepEqual(clampPlayerPosition({ x: -50, y: 9000 }, wide, player, 0), { x: 12, y: 700 - 240 - 12 });
  assert.equal(nearestCorner({ x: 40, y: 40 }, wide, player), "top-left");
  assert.equal(nearestCorner({ x: 500, y: 400 }, wide, player), "bottom-right");
  assert.equal(nearestCorner({ x: 500, y: 60 }, wide, player), "top-right");
  assert.equal(nearestCorner({ x: 60, y: 420 }, wide, player, 120), "bottom-left");
});

test("preview addresses must be loopback http(s) with a port", () => {
  assert.equal(isPreviewUrlValid(""), true);
  assert.equal(isPreviewUrlValid("  http://localhost:5173/app "), true);
  assert.equal(isPreviewUrlValid("https://127.0.0.1:8443"), true);
  assert.equal(isPreviewUrlValid("http://[::1]:3000"), true);
  assert.equal(isPreviewUrlValid("http://localhost"), false);
  assert.equal(isPreviewUrlValid("https://example.com:443"), false);
  assert.equal(isPreviewUrlValid("http://user:pw@localhost:3000"), false);
  assert.equal(isPreviewUrlValid("javascript:alert(1)"), false);
  assert.equal(isPreviewUrlValid("http://localhost:3000/a b"), false);
});

const native: NativeLocalServer[] = [
  { url: "http://localhost:5173", port: 5173, pid: 900, process: "node", owned: true, inWorkspace: true },
  { url: "http://localhost:8899", port: 8899, pid: 901, process: "python3", owned: false, inWorkspace: false },
];

test("native listeners and scanned output merge into one row per port", () => {
  const merged = mergeLocalServers(native, ["http://localhost:5173/", "http://127.0.0.1:3000", "http://localhost:3000/app"]);
  assert.deepEqual(merged.map((entry) => entry.url), ["http://localhost:5173", "http://localhost:8899", "http://127.0.0.1:3000"]);
  assert.equal(merged[0].process, "node");
  assert.equal(merged[0].owned, true);
  assert.equal(merged[2].process, null);
  assert.equal(merged[2].owned, null);
  assert.equal(urlPort("https://example.com"), 443);
  assert.equal(urlPort("not a url"), null);
  const many = mergeLocalServers([], Array.from({ length: 12 }, (_, index) => `http://localhost:${4000 + index}`));
  assert.equal(many.length, 8);
});

test("scanning output still finds local URLs only", () => {
  assert.deepEqual(scanLocalServers("ready on http://localhost:4321/"), ["http://localhost:4321"]);
});

test("annotation text names the page, viewport and each element", () => {
  const text = annotationText({
    url: "http://localhost:5173/app", viewportWidth: 1280.4, viewportHeight: 800,
    elements: [{ selector: "button#save", label: "button \"Save\"", x: 1, y: 2, width: 3, height: 4 }],
  });
  assert.equal(text, "Page: http://localhost:5173/app\nViewport: 1280×800\n\nAnnotated elements:\n1. button \"Save\" — button#save");
  assert.equal(annotationText({ url: "", viewportWidth: 1, viewportHeight: 1, elements: [] }).split("\n")[0], "Page: (unknown)");
});

test("the crop covers every marked element, padded and scaled to the image", () => {
  const elements = [
    { selector: "a", label: "a", x: 100, y: 50, width: 40, height: 20 },
    { selector: "b", label: "b", x: 300, y: 200, width: 50, height: 30 },
  ];
  // A 2x snapshot of a 1000x800 viewport.
  const rect = annotationCropRect(elements, { width: 1000, height: 800 }, { width: 2000, height: 1600 }, 10);
  assert.deepEqual(rect, { x: 180, y: 80, width: 2 * (350 + 10 - 90), height: 2 * (230 + 10 - 40) });
  // Padding cannot leave the image.
  const edge = annotationCropRect([{ selector: "c", label: "c", x: 990, y: 790, width: 40, height: 40 }], { width: 1000, height: 800 }, { width: 1000, height: 800 }, 16);
  assert.ok(edge && edge.x + edge.width <= 1000 && edge.y + edge.height <= 800);
  assert.equal(annotationCropRect([], { width: 1, height: 1 }, { width: 1, height: 1 }), null);
  assert.equal(annotationCropRect(elements, { width: 0, height: 800 }, { width: 1, height: 1 }), null);
});

test("text travels as base64 UTF-8", () => {
  assert.equal(base64Text("ação"), Buffer.from("ação", "utf8").toString("base64"));
});

test("the player shows only a revealed, loaded page the dock is not already showing", () => {
  const shown = { revealed: true, browserOpen: true, pageLoaded: true, pictureInPicture: false, dockShowing: false };
  assert.equal(agentPageShows(shown), true);
  assert.equal(agentPageShows({ ...shown, revealed: false }), false);
  assert.equal(agentPageShows({ ...shown, browserOpen: false }), false);
  assert.equal(agentPageShows({ ...shown, pageLoaded: false }), false);
  assert.equal(agentPageShows({ ...shown, pictureInPicture: true }), false);
  assert.equal(agentPageShows({ ...shown, dockShowing: true }), false);
});
