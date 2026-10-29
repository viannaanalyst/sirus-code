import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCESSORIES, ACCESSORY_INK, AVATAR_ACCESSORIES, AVATAR_EYES, AVATAR_ROWS, AVATAR_SIZE, AVATAR_SWATCHES, avatarBoxSize, avatarDeviceScale, avatarRamp, defaultLook, eyePixels, gazeToward,
  hexToOklch, hueToward, inside, MASK, oklchToRgba, poseKey, renderAvatar, resolveLook, RESTING_POSE, shuffleLook, workingPose,
  type AvatarAccessory, type AvatarEyes, type AvatarPose,
} from "../src/lib/project-avatar.ts";
import { projectAvatarStates } from "../src/lib/project-avatar-state.ts";

const pixel = (buffer: Uint8ClampedArray, x: number, y: number, k = 1) => {
  const at = (y * k * AVATAR_SIZE * k + x * k) * 4;
  return [buffer[at]!, buffer[at + 1]!, buffer[at + 2]!, buffer[at + 3]!];
};
const WHITE_MIN = 235;
const SIRUS_CODE_LOOK = { color: "#5b8def", eyes: "bars", accessory: "antenna" };

test("hex converts to OKLCH and back", () => {
  const { l, c, h } = hexToOklch("#8b7cf6");
  assert.ok(l > 0.6 && l < 0.75, `lightness ${l}`);
  assert.ok(c > 0.1 && c < 0.2, `chroma ${c}`);
  assert.ok(h > 270 && h < 300, `hue ${h}`);
  const [r, g, b, a] = oklchToRgba(l, c, h);
  assert.equal(a, 255);
  for (const [got, want] of [[r, 0x8b], [g, 0x7c], [b, 0xf6]] as const) assert.ok(Math.abs(got - want) <= 1, `${got} vs ${want}`);
});

test("hue shifts along the short arc", () => {
  assert.equal(Math.round(hueToward(350, 10, 0.5)), 0);
  assert.equal(Math.round(hueToward(10, 350, 0.5)), 0);
  assert.equal(Math.round(hueToward(100, 100, 0.9)), 100);
  assert.equal(Math.round(hueToward(200, 265, 0.5)), 233);
});

test("the ramp keeps its roles ordered by lightness and drifts shadows cool and lights warm", () => {
  const ramp = avatarRamp("#fb923c");
  const light = (rgba: readonly number[]) => 0.2126 * rgba[0]! + 0.7152 * rgba[1]! + 0.0722 * rgba[2]!;
  assert.ok(light(ramp.edge) < light(ramp.side));
  assert.ok(light(ramp.side) < light(ramp.base));
  assert.ok(light(ramp.base) < light(ramp.light));
  assert.ok(light(ramp.light) < light(ramp.shine));
  const orange = hexToOklch("#fb923c").h;
  const shadow = hexToOklch(`#${[...ramp.side.slice(0, 3)].map((v) => v.toString(16).padStart(2, "0")).join("")}`).h;
  const away = (from: number, to: number) => Math.abs(((to - from + 540) % 360) - 180);
  assert.ok(away(shadow, 265) < away(orange, 265), `shadow hue ${shadow} is nearer blue than ${orange}`);
  const lightHue = hexToOklch(`#${[...ramp.light.slice(0, 3)].map((v) => v.toString(16).padStart(2, "0")).join("")}`).h;
  assert.ok(away(lightHue, 85) <= away(orange, 85), `light hue ${lightHue} is nearer yellow than ${orange}`);
  // A grey input still gets a tinted, readable ramp.
  const grey = avatarRamp("#808080");
  assert.ok(grey.base[0] !== grey.base[2] || grey.base[1] !== grey.base[2]);
});

test("defaults come from the name and never change", () => {
  assert.deepEqual(defaultLook("sirus-code"), defaultLook("sirus-code"));
  assert.deepEqual(defaultLook("sirus-code"), SIRUS_CODE_LOOK, "the hash is part of the contract: changing it would change every project's face");
  const names = Array.from({ length: 200 }, (_, index) => `project-${index}`);
  const looks = names.map(defaultLook);
  for (const look of looks) {
    assert.ok((AVATAR_SWATCHES as readonly string[]).includes(look.color));
    assert.ok((AVATAR_ACCESSORIES as readonly string[]).includes(look.accessory));
    assert.equal(look.eyes, "bars");
  }
  assert.ok(new Set(looks.map((look) => look.color)).size >= 8, "names spread over the swatches");
  assert.equal(new Set(looks.map((look) => look.accessory)).size, AVATAR_ACCESSORIES.length, "and over the accessories");
});

test("saved choices win over defaults and bad values fall back", () => {
  const base = defaultLook("x");
  assert.deepEqual(resolveLook("x", null), base);
  assert.deepEqual(resolveLook("x", { color: "#AABBCC", eyes: "happy", accessory: "crown" }), { color: "#aabbcc", eyes: "happy", accessory: "crown" });
  assert.deepEqual(resolveLook("x", { color: "red", eyes: "laser" as never, accessory: "cape" as never }), base);
  const pick = shuffleLook(() => 0);
  assert.deepEqual(pick, { color: AVATAR_SWATCHES[0], eyes: "bars", accessory: "none" });
  const last = shuffleLook(() => 0.999999);
  assert.deepEqual(last, { color: AVATAR_SWATCHES.at(-1), eyes: "happy", accessory: "scarf" });
});

test("appearances saved before v2 keep loading: old eyes map to the new ones, mouth and cheeks are ignored", () => {
  const base = defaultLook("x");
  const old = (eyes: string) => ({ color: "#5b8def", eyes, mouth: "smile", cheeks: true }) as never;
  assert.equal(resolveLook("x", old("dot")).eyes, "dots");
  assert.equal(resolveLook("x", old("round")).eyes, "dots");
  assert.equal(resolveLook("x", old("wide")).eyes, "bars");
  assert.equal(resolveLook("x", old("sleepy")).eyes, "sleepy");
  assert.equal(resolveLook("x", old("toString")).eyes, base.eyes, "inherited keys are not eye names");
  const loaded = resolveLook("x", old("round"));
  assert.deepEqual(loaded, { color: "#5b8def", eyes: "dots", accessory: base.accessory }, "no accessory saved: the name's default");
  assert.deepEqual(Object.keys(loaded).sort(), ["accessory", "color", "eyes"]);
});

test("the mask is a 16 by 16 rounded block with no tail", () => {
  assert.equal(MASK.length, AVATAR_SIZE);
  for (const row of MASK) assert.equal(row.length, AVATAR_SIZE);
  assert.ok(inside(8, 3) && inside(2, 5) && inside(13, 11) && inside(4, 13), "block");
  assert.ok(!inside(1, 15) && !inside(2, 14) && !inside(3, 13), "no tail, rounded bottom corner");
  assert.ok(!inside(0, 0) && !inside(13, 14) && !inside(15, 15), "empty around");
  assert.ok(!inside(3, 3) && inside(4, 3), "rounded top corner");
});

test("the ramp's roles stay ordered edge < side < base < light < shine, and the eye is nearly white", () => {
  const ramp = avatarRamp("#2dd4bf");
  const lum = (rgba: readonly number[]) => 0.2126 * rgba[0]! + 0.7152 * rgba[1]! + 0.0722 * rgba[2]!;
  assert.ok(lum(ramp.eyeShade) < lum(ramp.side));
  assert.ok(lum(ramp.eye) > 240);
});

test("the sprite fills a 16 by 17 buffer: a block with an edge and an extruded side, transparent elsewhere", () => {
  const look = { color: "#5b8def", eyes: "bars", accessory: "none" } as const;
  const buffer = renderAvatar(look);
  assert.equal(buffer.length, AVATAR_SIZE * AVATAR_ROWS * 4);
  const ramp = avatarRamp(look.color);
  assert.equal(pixel(buffer, 0, 0)[3], 0, "empty corner");
  assert.equal(pixel(buffer, 15, 16)[3], 0, "empty under the right side");
  assert.equal(pixel(buffer, 1, 16)[3], 0, "no tail under the left side");
  assert.deepEqual(pixel(buffer, 8, 4), [...ramp.edge], "top edge");
  assert.deepEqual(pixel(buffer, 2, 8), [...ramp.edge], "left edge");
  assert.deepEqual(pixel(buffer, 12, 8), [...ramp.side], "extruded right side, two pixels wide");
  assert.deepEqual(pixel(buffer, 11, 8), [...ramp.side]);
  assert.deepEqual(pixel(buffer, 8, 13), [...ramp.side], "extruded bottom, one pixel above the edge");
  assert.deepEqual(pixel(buffer, 4, 6), [...ramp.shine], "catch-light");
  assert.deepEqual(pixel(buffer, 5, 6), [...ramp.shine]);
  assert.deepEqual(pixel(buffer, 4, 7), [...ramp.shine]);
  assert.deepEqual(pixel(buffer, 3, 6), [...ramp.light], "the lit corner fades through a checker into the base");
  assert.deepEqual(pixel(buffer, 12, 12).slice(0, 3), [...ramp.side].slice(0, 3));
  assert.deepEqual(pixel(buffer, 10, 11), [...ramp.base], "far from the light it is the base colour");
});

test("every eye style draws white pixels, none draws a mouth or cheeks", () => {
  const draw = (eyes: AvatarEyes, pose = RESTING_POSE) => renderAvatar({ color: "#facc15", eyes, accessory: "none" }, pose);
  const whites = (buffer: Uint8ClampedArray) => {
    let n = 0;
    for (let y = 0; y < AVATAR_ROWS; y += 1) for (let x = 0; x < AVATAR_SIZE; x += 1) { const p = pixel(buffer, x, y); if (p[0]! >= WHITE_MIN && p[1]! >= WHITE_MIN && p[2]! >= WHITE_MIN) n += 1; }
    return n;
  };
  assert.equal(whites(draw("bars")), 6, "two bars of three");
  assert.equal(whites(draw("dots")), 8, "two blocks of four");
  assert.equal(whites(draw("sleepy")), 4);
  assert.equal(whites(draw("happy")), 6);
  assert.equal(new Set(AVATAR_EYES.map((eyes) => JSON.stringify(eyePixels(eyes, RESTING_POSE)))).size, 4);
  // Bars: tall white bars with a shade pixel below (the body rests one row down).
  const ramp = avatarRamp("#facc15");
  const bars = draw("bars");
  assert.deepEqual(pixel(bars, 6, 8), [...ramp.eye]);
  assert.deepEqual(pixel(bars, 6, 10), [...ramp.eye]);
  assert.deepEqual(pixel(bars, 6, 11), [...ramp.eyeShade]);
  // Blinking closes the eyes; sleepy eyes are already closed; the gaze moves them; waiting is happy.
  const marks = (eyes: AvatarEyes, pose: AvatarPose = RESTING_POSE) => JSON.stringify(eyePixels(eyes, pose));
  assert.notEqual(marks("bars"), marks("bars", { ...RESTING_POSE, blink: true }));
  assert.equal(marks("sleepy"), marks("sleepy", { ...RESTING_POSE, blink: true }));
  assert.notEqual(marks("bars"), marks("bars", { ...RESTING_POSE, gaze: 1 }));
  assert.notEqual(marks("bars", { ...RESTING_POSE, gaze: 1 }), marks("bars", { ...RESTING_POSE, gaze: -1 }));
  assert.equal(marks("bars", { ...RESTING_POSE, state: "waiting" }), marks("happy"));
});

test("accessories paint their own pixels over the body, and none paints nothing", () => {
  const look = (accessory: AvatarAccessory) => ({ color: "#5b8def", eyes: "bars", accessory }) as const;
  const plain = renderAvatar(look("none"));
  const cells = (buffer: Uint8ClampedArray) => { const out: string[] = []; for (let y = 0; y < AVATAR_ROWS; y += 1) for (let x = 0; x < AVATAR_SIZE; x += 1) out.push(pixel(buffer, x, y).join(",")); return out; };
  const seen = new Set<string>();
  for (const accessory of AVATAR_ACCESSORIES) {
    assert.equal(ACCESSORIES[accessory].length === 0, accessory === "none");
    const buffer = renderAvatar(look(accessory));
    seen.add(cells(buffer).join("|"));
    if (accessory !== "none") assert.notDeepEqual(cells(buffer), cells(plain), accessory);
  }
  assert.equal(seen.size, AVATAR_ACCESSORIES.length, "each one looks different");
  const dark = ACCESSORY_INK.H!;
  assert.ok(dark[0] > 40 && dark[1] > 40 && dark[2] > 40, "graphite, never pure black");
  assert.ok(ACCESSORY_INK.h![0] > dark[0], "a lit top edge is lighter than the dark part");
  // The top hat: graphite crown row 1 of the sprite (drawn one row down), a red band, a lit top edge.
  const hat = renderAvatar(look("tophat"));
  assert.deepEqual(pixel(hat, 6, 1), [...ACCESSORY_INK.h!]);
  assert.deepEqual(pixel(hat, 6, 2), [...ACCESSORY_INK.H!]);
  assert.deepEqual(pixel(hat, 6, 3), [...ACCESSORY_INK.R!]);
  // The antenna tip takes the bubble's own edge colour.
  assert.deepEqual(pixel(renderAvatar(look("antenna")), 8, 3), [...avatarRamp("#5b8def").edge]);
});

test("waiting shows the violet corner notch and happy eyes; working bobs", () => {
  const look = { color: "#5b8def", eyes: "bars", accessory: "none" } as const;
  const idle = renderAvatar(look);
  const waiting = renderAvatar(look, { ...RESTING_POSE, state: "waiting" });
  const ramp = avatarRamp(look.color);
  assert.notDeepEqual(pixel(idle, 15, 0), [...ramp.notchLight]);
  assert.deepEqual(pixel(waiting, 15, 0), [...ramp.notchLight]);
  assert.deepEqual(pixel(waiting, 12, 0), [...ramp.notchDark]);
  assert.deepEqual(pixel(waiting, 12, 3), [...ramp.notchDark]);
  const rest = renderAvatar(look, { ...RESTING_POSE, state: "working" });
  const hop = renderAvatar(look, { ...RESTING_POSE, state: "working", bob: true });
  assert.equal(pixel(rest, 8, 3)[3], 0, "resting body starts one row down");
  assert.equal(pixel(hop, 8, 3)[3], 255, "the hop lifts it");
  assert.equal(pixel(hop, 1, 16)[3], 0);
});

test("an exact integer scale repeats every pixel as a block", () => {
  const look = { color: "#f472b6", eyes: "dots", accessory: "crown" } as const;
  const one = renderAvatar(look, RESTING_POSE, 1);
  const three = renderAvatar(look, RESTING_POSE, 3);
  assert.equal(three.length, one.length * 9);
  for (let y = 0; y < AVATAR_ROWS; y += 1) for (let x = 0; x < AVATAR_SIZE; x += 1) {
    const want = pixel(one, x, y);
    for (const [dx, dy] of [[0, 0], [2, 0], [0, 2], [2, 2], [1, 1]] as const) {
      const at = ((y * 3 + dy) * AVATAR_SIZE * 3 + x * 3 + dx) * 4;
      assert.deepEqual([three[at], three[at + 1], three[at + 2], three[at + 3]], want);
    }
  }
});

test("sizes give whole device pixels per sprite pixel at 2x: 16 css px is 2x, 24 is 3x, 32 is 4x", () => {
  assert.deepEqual([12, 14, 16, 17].map(avatarBoxSize), [16, 16, 16, 16]);
  assert.deepEqual([20, 24, 28].map(avatarBoxSize), [24, 24, 24]);
  assert.deepEqual([32, 40].map(avatarBoxSize), [32, 32]);
  assert.deepEqual([16, 24, 32].map((size) => avatarDeviceScale(size, 2)), [2, 3, 4]);
  assert.deepEqual([16, 24, 32].map((size) => avatarDeviceScale(size, 1)), [1, 1, 2]);
  assert.deepEqual([16, 24, 32].map((size) => avatarDeviceScale(size, 3)), [3, 4, 6]);
  for (const dpr of [1, 1.25, 1.5, 2, 3]) for (const size of [12, 16, 24, 32]) assert.ok(Number.isInteger(avatarDeviceScale(size, dpr)) && avatarDeviceScale(size, dpr) >= 1);
});

test("gaze follows the pointer only when it is near", () => {
  assert.equal(gazeToward(100, 0), 1);
  assert.equal(gazeToward(-100, 10), -1);
  assert.equal(gazeToward(10, 0), 0);
  assert.equal(gazeToward(500, 0), 0);
  assert.equal(gazeToward(100, 400), 0);
});

test("the working pose cycles through a bob and a glance", () => {
  const poses = Array.from({ length: 16 }, (_, tick) => workingPose(tick));
  assert.ok(poses.some((pose) => pose.bob) && poses.some((pose) => !pose.bob));
  assert.deepEqual([...new Set(poses.map((pose) => pose.gaze))].sort(), [-1, 0, 1]);
  assert.equal(new Set(poses.map(poseKey)).size > 4, true);
  assert.deepEqual(workingPose(0), workingPose(16), "it repeats");
});

const session = (id: string, projectId: string, status: string, extra: object = {}) => ({ id, projectId, status, ...extra }) as never;

test("a project's avatar shows waiting before working, and unread counts as waiting", () => {
  const none = new Set<string>();
  assert.deepEqual(projectAvatarStates([session("a", "p", "running"), session("b", "q", "idle")], none, none), { p: "working" });
  assert.deepEqual(projectAvatarStates([session("a", "p", "running"), session("b", "p", "waiting")], none, none), { p: "waiting" });
  assert.deepEqual(projectAvatarStates([session("b", "p", "waiting"), session("a", "p", "running")], none, none), { p: "waiting" });
  assert.deepEqual(projectAvatarStates([session("a", "p", "completed")], new Set(["a"]), none), { p: "waiting" });
  assert.deepEqual(projectAvatarStates([session("a", "p", "idle")], none, new Set(["a"])), { p: "waiting" });
  assert.deepEqual(projectAvatarStates([session("a", "p", "idle")], none, none), {});
});
