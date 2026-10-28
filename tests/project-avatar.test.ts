import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AVATAR_EYES, AVATAR_MOUTHS, AVATAR_ROWS, AVATAR_SIZE, AVATAR_SWATCHES, avatarRamp, defaultLook, faceMarks, gazeToward, hexToOklch, hueToward, oklchToRgba,
  poseKey, renderAvatar, resolveLook, RESTING_POSE, shuffleLook, workingPose,
} from "../src/lib/project-avatar.ts";
import { projectAvatarStates } from "../src/lib/project-avatar-state.ts";

const pixel = (buffer: Uint8ClampedArray, x: number, y: number, k = 1) => {
  const at = (y * k * AVATAR_SIZE * k + x * k) * 4;
  return [buffer[at]!, buffer[at + 1]!, buffer[at + 2]!, buffer[at + 3]!];
};
const WHITE_MIN = 235;
const SIRUS_CODE_LOOK = { color: "#5b8def", eyes: "dot", mouth: "smile", cheeks: true };

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
  assert.ok(light(ramp.outline) < light(ramp.shadow));
  assert.ok(light(ramp.shadow) < light(ramp.base));
  assert.ok(light(ramp.base) < light(ramp.light));
  assert.ok(light(ramp.light) < light(ramp.shine));
  const orange = hexToOklch("#fb923c").h;
  const shadow = hexToOklch(`#${[...ramp.shadow.slice(0, 3)].map((v) => v.toString(16).padStart(2, "0")).join("")}`).h;
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
    assert.ok((AVATAR_EYES as readonly string[]).includes(look.eyes));
    assert.ok((AVATAR_MOUTHS as readonly string[]).includes(look.mouth));
  }
  assert.ok(new Set(looks.map((look) => look.color)).size >= 8, "names spread over the swatches");
  assert.ok(new Set(looks.map((look) => look.eyes)).size === AVATAR_EYES.length);
  assert.ok(new Set(looks.map((look) => look.cheeks)).size === 2);
});

test("saved choices win over defaults and bad values fall back", () => {
  const base = defaultLook("x");
  assert.deepEqual(resolveLook("x", null), base);
  assert.deepEqual(resolveLook("x", { color: "#AABBCC", eyes: "sleepy", mouth: "flat", cheeks: true }), { color: "#aabbcc", eyes: "sleepy", mouth: "flat", cheeks: true });
  assert.deepEqual(resolveLook("x", { color: "red", eyes: "laser" as never, mouth: "" as never }), base);
  const pick = shuffleLook(() => 0);
  assert.deepEqual(pick, { color: AVATAR_SWATCHES[0], eyes: "dot", mouth: "smile", cheeks: false });
  const last = shuffleLook(() => 0.999999);
  assert.equal(last.color, AVATAR_SWATCHES.at(-1));
});

test("the sprite fills a 12 by 13 buffer: a bubble with an outline and a tail, transparent elsewhere", () => {
  const look = { color: "#5b8def", eyes: "dot", mouth: "smile", cheeks: false } as const;
  const buffer = renderAvatar(look);
  assert.equal(buffer.length, AVATAR_SIZE * AVATAR_ROWS * 4);
  assert.equal(pixel(buffer, 0, 0)[3], 0, "empty corner");
  assert.equal(pixel(buffer, 11, 12)[3], 0, "empty under the right side");
  assert.equal(pixel(buffer, 0, 12)[3], 255, "tail tip");
  assert.equal(pixel(buffer, 1, 12)[3], 255, "tail");
  const ramp = avatarRamp(look.color);
  assert.deepEqual(pixel(buffer, 5, 1), [...ramp.outline], "top edge is outline");
  assert.deepEqual(pixel(buffer, 3, 3), [...ramp.shine], "highlight");
  assert.deepEqual(pixel(buffer, 0, 5), [...ramp.outline], "side edge is outline");
});

test("faces are white with an outline-toned drop shadow and no black ink", () => {
  const look = { color: "#facc15", eyes: "dot", mouth: "flat", cheeks: false } as const;
  const buffer = renderAvatar(look);
  const ramp = avatarRamp(look.color);
  // Left eye: (3,4) and (3,5) in the sprite, drawn one row down.
  const eye = pixel(buffer, 3, 5);
  assert.ok(eye[0]! >= WHITE_MIN && eye[1]! >= WHITE_MIN && eye[2]! >= WHITE_MIN, `eye ${eye}`);
  assert.deepEqual(pixel(buffer, 4, 7), [...ramp.outline], "shadow one pixel down and right of the lower eye pixel");
  for (const [x, y] of faceMarks(look, RESTING_POSE)) {
    const mark = pixel(buffer, x, y + 1);
    assert.ok(mark[0]! >= WHITE_MIN && mark[1]! >= WHITE_MIN && mark[2]! >= WHITE_MIN, `mark ${x},${y}: ${mark}`);
  }
});

test("eyes, mouths, blinks and gaze change the marks", () => {
  const marks = (eyes: (typeof AVATAR_EYES)[number], mouth: (typeof AVATAR_MOUTHS)[number], pose = RESTING_POSE) => JSON.stringify(faceMarks({ eyes, mouth }, pose));
  assert.equal(new Set(AVATAR_EYES.map((eyes) => marks(eyes, "flat"))).size, 4);
  assert.equal(new Set(AVATAR_MOUTHS.map((mouth) => marks("dot", mouth))).size, 3);
  assert.notEqual(marks("dot", "flat"), marks("dot", "flat", { ...RESTING_POSE, blink: true }));
  assert.equal(marks("sleepy", "flat"), marks("sleepy", "flat", { ...RESTING_POSE, blink: true }), "sleepy eyes already look closed");
  assert.notEqual(marks("round", "flat"), marks("round", "flat", { ...RESTING_POSE, gaze: 1 }));
  assert.notEqual(marks("round", "flat"), marks("round", "flat", { ...RESTING_POSE, gaze: -1 }));
  assert.notEqual(marks("dot", "flat"), marks("dot", "flat", { ...RESTING_POSE, state: "waiting" }));
});

test("waiting shows the violet notch and the cheeks; working bobs", () => {
  const look = { color: "#5b8def", eyes: "dot", mouth: "flat", cheeks: false } as const;
  const idle = renderAvatar(look);
  const waiting = renderAvatar(look, { ...RESTING_POSE, state: "waiting" });
  const ramp = avatarRamp(look.color);
  assert.equal(pixel(idle, 11, 0)[3], 0);
  assert.deepEqual(pixel(waiting, 11, 0), [...ramp.notchLight]);
  assert.deepEqual(pixel(waiting, 9, 2), [...ramp.notchDark]);
  assert.deepEqual(pixel(waiting, 2, 8), [...ramp.cheek]);
  assert.notDeepEqual(pixel(idle, 2, 8), [...ramp.cheek]);
  const rest = renderAvatar(look, { ...RESTING_POSE, state: "working" });
  const hop = renderAvatar(look, { ...RESTING_POSE, state: "working", bob: true });
  assert.equal(pixel(rest, 4, 0)[3], 0, "resting body starts one row down");
  assert.equal(pixel(hop, 4, 0)[3], 255, "the hop lifts it");
  assert.equal(pixel(hop, 0, 12)[3], 0);
});

test("an exact integer scale repeats every pixel as a block", () => {
  const look = { color: "#f472b6", eyes: "wide", mouth: "o", cheeks: true } as const;
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

test("gaze follows the pointer only when it is near", () => {
  assert.equal(gazeToward(100, 0), 1);
  assert.equal(gazeToward(-100, 10), -1);
  assert.equal(gazeToward(10, 0), 0);
  assert.equal(gazeToward(500, 0), 0);
  assert.equal(gazeToward(100, 400), 0);
});

test("the working pose cycles through a bob, a talking mouth and a glance", () => {
  const poses = Array.from({ length: 16 }, (_, tick) => workingPose(tick));
  assert.ok(poses.some((pose) => pose.bob) && poses.some((pose) => !pose.bob));
  assert.ok(poses.some((pose) => pose.talk) && poses.some((pose) => !pose.talk));
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
