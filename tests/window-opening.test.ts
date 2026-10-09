import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OPENING_MS, OPENING_REDUCED_MS, beginWindowOpening, endWindowOpening, openingDuration, openingReduced, playWindowOpening } from "../src/lib/window-opening.ts";

const fakeRoot = () => ({ dataset: {} as DOMStringMap });

test("the opening plays once, after the native window is shown, and clears itself", async () => {
  const root = fakeRoot();
  const timers: { run: () => void; ms: number }[] = [];
  const schedule = (run: () => void, ms: number) => timers.push({ run, ms });
  let shown = 0;
  let release!: () => void;
  const showWindow = () => { shown += 1; return new Promise<void>(resolve => { release = resolve; }); };

  beginWindowOpening(root);
  assert.equal(root.dataset.opening, "pending");
  const first = playWindowOpening(showWindow, root, false, schedule);
  // The root stays hidden until the window is on screen; a second ready signal does nothing.
  assert.equal(root.dataset.opening, "showing");
  assert.equal(await playWindowOpening(showWindow, root, false, schedule), false);
  assert.equal(shown, 1);
  release();
  assert.equal(await first, true);
  assert.equal(root.dataset.opening, "play");
  assert.deepEqual(timers.map(timer => timer.ms), [OPENING_MS]);
  timers[0].run();
  assert.equal(root.dataset.opening, undefined);
});

test("a failed show still reveals; without a begun opening nothing happens", async () => {
  const root = fakeRoot();
  beginWindowOpening(root);
  assert.equal(await playWindowOpening(() => Promise.reject(new Error("remote")), root, false, () => undefined), true);
  assert.equal(root.dataset.opening, "play");

  const idle = fakeRoot();
  let called = false;
  assert.equal(await playWindowOpening(async () => { called = true; }, idle, false, () => undefined), false);
  assert.equal(called, false);
  assert.equal(idle.dataset.opening, undefined);
});

test("the fatal panel ends a pending opening so the reveal never runs over it", async () => {
  const root = fakeRoot();
  beginWindowOpening(root);
  const played = playWindowOpening(() => Promise.resolve(), root, false, () => undefined);
  endWindowOpening(root);
  assert.equal(await played, false);
  assert.equal(root.dataset.opening, undefined);
});

test("reduced motion shortens the opening to a quick fade", () => {
  assert.equal(openingReduced({}, false), false);
  assert.equal(openingReduced({}, true), true);
  assert.equal(openingReduced({ animations: "off" }, false), true);
  assert.equal(openingReduced({ reduceMotion: "on" }, false), true);
  assert.equal(openingDuration(false), OPENING_MS);
  assert.equal(openingDuration(true), OPENING_REDUCED_MS);
  // The longest piece (140 ms delay + 450 ms slide) and the 550 ms wipe end before the attribute goes.
  assert.ok(OPENING_MS >= Math.max(550, 140 + 450));
  assert.ok(OPENING_REDUCED_MS >= 150);
});

test("no launch splash; the opening animates only clip-path, transform and opacity", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /app-splash|sirus-glyph/);
  const css = readFileSync(new URL("../src/styles/opening.css", import.meta.url), "utf8");
  const animated = [...css.matchAll(/@keyframes[^{]+\{([\s\S]*?)\}\s*\}/g)].flatMap(([, body]) => [...body.matchAll(/([a-z-]+)\s*:/g)].map(([, property]) => property));
  assert.ok(animated.length > 0);
  for (const property of animated) assert.ok(["clip-path", "transform", "opacity", "visibility"].includes(property), property);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /data-animations="off"/);
});

test("the last applied look is remembered for the next launch", async () => {
  const { rememberAppearance, APPEARANCE_SNAPSHOT_KEY } = await import("../src/lib/settings.ts");
  const saved = new Map<string, string>();
  const attributes: Record<string, string> = { style: "--window-opacity: 77%; --chat-background: url(blob:x); --sidebar-opacity: 72%" };
  const root = {
    dataset: { theme: "dark", windowGlass: "on", sidebarGlass: "off" } as DOMStringMap,
    getAttribute: (name: string) => attributes[name] ?? null,
    classList: { contains: (name: string) => name === "dark" },
  } as unknown as HTMLElement;
  rememberAppearance(root, { setItem: (key, value) => void saved.set(key, value) });
  const snapshot = JSON.parse(saved.get(APPEARANCE_SNAPSHOT_KEY)!);
  assert.equal(snapshot.dataset.windowGlass, "on");
  assert.equal(snapshot.dark, true);
  assert.ok(snapshot.style.includes("--window-opacity: 77%"));
  assert.ok(!snapshot.style.includes("--chat-background"), "a blob URL does not survive a restart");
});
