/**
 * Project avatars (ADR-175, v2): a 16x16 pixel speech bubble (a rounded block with the bubble's
 * tail) with eyes and an optional accessory, drawn pixel by pixel into a buffer. Everything here
 * is pure: the colour ramp (a hex colour turned into role colours in OKLCH with hue shifts), the
 * deterministic defaults from the project name, and the sprite (mask, shading, eyes, accessories).
 * `components/ProjectAvatar.tsx` paints the buffer on a canvas and `avatar-scheduler.ts` decides
 * when to repaint.
 */
import type { ProjectAppearance } from "@/client/types";

export const AVATAR_SIZE = 16;
/** One spare row under the sprite, for the two-frame bob. */
export const AVATAR_ROWS = 17;

export const AVATAR_EYES = ["bars", "dots", "sleepy", "happy"] as const;
export const AVATAR_ACCESSORIES = ["none", "tophat", "crown", "antenna", "bow", "flower", "beanie", "headset", "scarf"] as const;
export type AvatarEyes = (typeof AVATAR_EYES)[number];
export type AvatarAccessory = (typeof AVATAR_ACCESSORIES)[number];
export type AvatarState = "idle" | "working" | "waiting";
export type AvatarGaze = -1 | 0 | 1;

export interface AvatarLook { color: string; eyes: AvatarEyes; accessory: AvatarAccessory }
/** One frame of the animation: what moves, not how it is drawn. */
export interface AvatarPose { state: AvatarState; blink: boolean; gaze: AvatarGaze; bob: boolean }

export const AVATAR_SWATCHES = ["#8b7cf6", "#5b8def", "#38bdf8", "#2dd4bf", "#4ade80", "#a3c94a", "#facc15", "#fb923c", "#f87171", "#f472b6", "#c084fc", "#94a3b8"] as const;

export const RESTING_POSE: AvatarPose = { state: "idle", blink: false, gaze: 0, bob: false };

/** Eye names saved before v2 and the v2 eyes they become (the Rust side maps them on load too). */
export const LEGACY_EYES: Readonly<Record<string, AvatarEyes>> = { dot: "dots", round: "dots", wide: "bars", sleepy: "sleepy" };

// ---------------------------------------------------------------------------------------------
// Colour: hex -> OKLCH -> role ramp -> sRGB

export type Rgba = readonly [number, number, number, number];

export function hexToOklch(hex: string): { l: number; c: number; h: number } {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lab = { L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, A: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, B: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s };
  return { l: lab.L, c: Math.hypot(lab.A, lab.B), h: ((Math.atan2(lab.B, lab.A) * 180) / Math.PI + 360) % 360 };
}

export function oklchToRgba(l: number, c: number, h: number): Rgba {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_];
  const byte = (v: number) => {
    const x = Math.min(1, Math.max(0, v));
    return Math.round((x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055) * 255);
  };
  return [byte(lin[0]!), byte(lin[1]!), byte(lin[2]!), 255];
}

/** Moves hue `h` a fraction `amount` of the way to `target` along the short arc. */
export function hueToward(h: number, target: number, amount: number): number {
  const delta = ((target - h + 540) % 360) - 180;
  return (h + delta * amount + 360) % 360;
}

export interface AvatarRamp { edge: Rgba; side: Rgba; base: Rgba; light: Rgba; shine: Rgba; eye: Rgba; eyeShade: Rgba; notchDark: Rgba; notchLight: Rgba }

/**
 * Roles, not pixels: a new colour only rebuilds this ramp. Shadows drift cool (towards blue) and
 * lights warm (towards yellow), the way hand-drawn pixel art shifts hue instead of only lightness.
 */
export function avatarRamp(hex: string): AvatarRamp {
  const { c, h } = hexToOklch(hex);
  const chroma = Math.max(0.05, Math.min(0.17, c));
  const k = (x: number) => Math.max(0.02, chroma * x);
  return {
    edge: oklchToRgba(0.36, k(0.8), hueToward(h, 265, 0.3)),
    side: oklchToRgba(0.47, k(0.95), hueToward(h, 265, 0.2)),
    base: oklchToRgba(0.64, k(1), h),
    light: oklchToRgba(0.73, k(0.9), hueToward(h, 85, 0.1)),
    shine: oklchToRgba(0.93, k(0.35), hueToward(h, 85, 0.25)),
    eye: oklchToRgba(0.99, 0.01, h),
    eyeShade: oklchToRgba(0.3, k(0.6), hueToward(h, 265, 0.3)),
    notchDark: oklchToRgba(0.3, 0.08, 288),
    notchLight: oklchToRgba(0.84, 0.12, 288),
  };
}

// ---------------------------------------------------------------------------------------------
// Defaults and validation

export function hashName(name: string): number {
  let h = 2166136261;
  for (const ch of name) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The look every project has with no setup: colour and accessory taken from the name, `bars` eyes. */
export function defaultLook(name: string): AvatarLook {
  const h = hashName(name);
  return { color: AVATAR_SWATCHES[h % AVATAR_SWATCHES.length]!, eyes: "bars", accessory: AVATAR_ACCESSORIES[(h >>> 5) % AVATAR_ACCESSORIES.length]! };
}

const HEX = /^#[0-9a-f]{6}$/i;
export const isAvatarColor = (value: unknown): value is string => typeof value === "string" && HEX.test(value);

/** An eye name from a saved appearance, old ones mapped to their v2 equivalent; undefined when unknown. */
export function eyesFromSaved(value: unknown): AvatarEyes | undefined {
  if (typeof value !== "string") return undefined;
  if ((AVATAR_EYES as readonly string[]).includes(value)) return value as AvatarEyes;
  return Object.hasOwn(LEGACY_EYES, value) ? LEGACY_EYES[value] : undefined;
}

/** The saved choices over the defaults; a value the app does not know falls back to the default. Old `mouth` and `cheeks` are ignored. */
export function resolveLook(name: string, appearance?: Partial<ProjectAppearance> | null): AvatarLook {
  const base = defaultLook(name);
  if (!appearance) return base;
  return {
    color: isAvatarColor(appearance.color) ? appearance.color.toLowerCase() : base.color,
    eyes: eyesFromSaved(appearance.eyes) ?? base.eyes,
    accessory: (AVATAR_ACCESSORIES as readonly string[]).includes(appearance.accessory ?? "") ? appearance.accessory as AvatarAccessory : base.accessory,
  };
}

/** A random look for "Shuffle". `random` is injectable for tests. */
export function shuffleLook(random: () => number = Math.random): AvatarLook {
  const pick = <T,>(list: readonly T[]) => list[Math.min(list.length - 1, Math.floor(random() * list.length))]!;
  return { color: pick(AVATAR_SWATCHES), eyes: pick(AVATAR_EYES), accessory: pick(AVATAR_ACCESSORIES) };
}

export const lookKey = (look: AvatarLook) => `${look.color}|${look.eyes}|${look.accessory}`;

// ---------------------------------------------------------------------------------------------
// Sizes: whole device pixels per sprite pixel

/** The CSS width an avatar is drawn at for a glyph box of `size`: 16, 24 or 32 CSS px, so 2, 3 or 4 device pixels per sprite pixel at 2x. */
export function avatarBoxSize(size: number): 16 | 24 | 32 {
  return size <= 18 ? 16 : size <= 28 ? 24 : 32;
}

/** Device pixels per sprite pixel: a whole number, so every sprite pixel is the same square of device pixels. */
export function avatarDeviceScale(size: number, dpr: number): number {
  return Math.max(1, Math.floor((avatarBoxSize(size) * (dpr > 0 ? dpr : 1)) / AVATAR_SIZE + 0.49));
}

// ---------------------------------------------------------------------------------------------
// Animation frames

/** Pointer within reach of an avatar looks left or right; `dx`/`dy` are from the avatar's centre. */
export function gazeToward(dx: number, dy: number): AvatarGaze {
  if (Math.abs(dy) >= 240 || Math.abs(dx) >= 300) return 0;
  return dx > 18 ? 1 : dx < -18 ? -1 : 0;
}

/** Working, at one tick (about 200 ms): the bob every second tick, a glance every fourth. */
export function workingPose(tick: number): AvatarPose {
  return { state: "working", blink: false, gaze: ([0, 1, 0, -1] as const)[Math.floor(tick / 4) % 4]!, bob: Math.floor(tick / 2) % 2 === 1 };
}

export const poseKey = (pose: AvatarPose) => `${pose.state}${pose.blink ? "b" : ""}${pose.gaze}${pose.bob ? "u" : ""}`;

// ---------------------------------------------------------------------------------------------
// Sprite

/** A rounded block (rows 3..13, columns 2..13) with the speech-bubble tail at the bottom left. */
export const MASK = [
  "................",
  "................",
  "................",
  "....########....",
  "...##########...",
  "..############..",
  "..############..",
  "..############..",
  "..############..",
  "..############..",
  "..############..",
  "..############..",
  "...##########...",
  "...#########....",
  "..##............",
  ".##.............",
] as const;

export const inside = (x: number, y: number) => y >= 0 && y < AVATAR_SIZE && x >= 0 && x < AVATAR_SIZE && MASK[y]![x] === "#";

type AccessoryRect = readonly [ink: string, x: number, y: number, w: number, h: number];
/** Accessory rectangles in drawing order (later ones paint over earlier ones). Inks are named in `ACCESSORY_INK`. */
export const ACCESSORIES: Readonly<Record<AvatarAccessory, readonly AccessoryRect[]>> = {
  none: [],
  tophat: [["H", 5, 0, 6, 3], ["h", 5, 0, 6, 1], ["R", 5, 2, 6, 1], ["H", 3, 3, 10, 1], ["h", 3, 3, 10, 1]],
  crown: [["Y", 4, 0, 1, 1], ["Y", 7, 0, 2, 1], ["Y", 11, 0, 1, 1], ["Y", 4, 1, 8, 2], ["y", 4, 3, 8, 1], ["R", 7, 1, 2, 1], ["W", 5, 1, 1, 1]],
  antenna: [["R", 7, 0, 2, 2], ["W", 7, 0, 1, 1], ["E", 8, 2, 1, 1]],
  bow: [["P", 10, 1, 2, 3], ["P", 13, 1, 2, 3], ["p", 12, 2, 1, 1], ["P", 12, 1, 1, 1], ["W", 10, 1, 1, 1]],
  flower: [["W", 12, 0, 1, 1], ["W", 11, 1, 1, 1], ["W", 13, 1, 1, 1], ["W", 12, 2, 1, 1], ["Y", 12, 1, 1, 1]],
  beanie: [["B", 4, 1, 8, 2], ["b", 3, 3, 10, 1], ["W", 7, 0, 2, 1], ["bl", 5, 1, 1, 1], ["bl", 8, 1, 1, 1]],
  headset: [["H", 3, 1, 10, 1], ["h", 3, 1, 10, 1], ["H", 2, 2, 1, 3], ["H", 13, 2, 1, 3], ["H", 0, 6, 2, 4], ["h", 0, 6, 2, 1], ["H", 14, 6, 2, 4], ["h", 14, 6, 2, 1], ["H", 1, 10, 1, 2], ["H", 2, 11, 3, 1], ["R", 5, 11, 1, 1]],
  scarf: [["R", 2, 11, 12, 2], ["r", 2, 12, 12, 1], ["R", 3, 13, 2, 2], ["r", 3, 14, 2, 1]],
};

/** Accessory inks. No pure black: dark parts are graphite with a lit top edge so they read on the dark sidebar. "E" is the bubble's edge colour. */
export const ACCESSORY_INK: Readonly<Record<string, Rgba>> = {
  H: oklchToRgba(0.34, 0.015, 285), h: oklchToRgba(0.5, 0.015, 285),
  R: oklchToRgba(0.63, 0.2, 25), r: oklchToRgba(0.5, 0.18, 25),
  Y: oklchToRgba(0.86, 0.15, 88), y: oklchToRgba(0.7, 0.14, 70),
  P: oklchToRgba(0.76, 0.16, 350), p: oklchToRgba(0.52, 0.15, 350),
  W: oklchToRgba(0.98, 0.01, 90),
  B: oklchToRgba(0.6, 0.14, 255), b: oklchToRgba(0.47, 0.12, 255), bl: oklchToRgba(0.7, 0.12, 255),
};

export type EyePixel = readonly [x: number, y: number, shade: boolean];
/** The eye pixels for this look and pose, in sprite coordinates (before the body's one-row rest offset). `shade` marks the darker pixel under an eye. */
export function eyePixels(eyes: AvatarEyes, pose: AvatarPose): EyePixel[] {
  const out: EyePixel[] = [];
  const happy = pose.state === "waiting" || eyes === "happy";
  for (const ex of [6, 9]) {
    const x = ex + pose.gaze;
    if (pose.blink || eyes === "sleepy") out.push([x - 1, 9, false], [x, 9, false], [x - 1, 10, true], [x, 10, true]);
    else if (happy) out.push([x - 1, 9, false], [x, 8, false], [x + 1, 9, false]);
    else if (eyes === "dots") out.push([x - 1, 8, false], [x, 8, false], [x - 1, 9, false], [x, 9, false], [x - 1, 10, true], [x, 10, true]);
    else out.push([x, 7, false], [x, 8, false], [x, 9, false], [x, 10, true]);
  }
  return out;
}

const ramps = new Map<string, AvatarRamp>();
function rampFor(hex: string): AvatarRamp {
  let ramp = ramps.get(hex);
  if (!ramp) {
    if (ramps.size >= 64) ramps.clear();
    ramp = avatarRamp(hex);
    ramps.set(hex, ramp);
  }
  return ramp;
}

/**
 * The avatar as RGBA bytes, `16k` by `17k` pixels (each sprite pixel is a `k`-by-`k` block, so the
 * result is already at an exact integer scale). Transparent where nothing is drawn.
 */
export function renderAvatar(look: AvatarLook, pose: AvatarPose = RESTING_POSE, k = 1): Uint8ClampedArray<ArrayBuffer> {
  const width = AVATAR_SIZE * k;
  const out = new Uint8ClampedArray(width * AVATAR_ROWS * k * 4);
  const ramp = rampFor(look.color);
  const put = (x: number, y: number, color: Rgba, w = 1, h = 1) => {
    for (let sy = Math.max(0, y); sy < Math.min(AVATAR_ROWS, y + h); sy += 1) for (let sx = Math.max(0, x); sx < Math.min(AVATAR_SIZE, x + w); sx += 1) {
      for (let dy = 0; dy < k; dy += 1) for (let dx = 0; dx < k; dx += 1) {
        const at = ((sy * k + dy) * width + sx * k + dx) * 4;
        out[at] = color[0]; out[at + 1] = color[1]; out[at + 2] = color[2]; out[at + 3] = color[3];
      }
    }
  };
  const top = pose.state === "working" && pose.bob ? 0 : 1; // the body rests one row down, the hop lifts it
  for (let y = 0; y < AVATAR_SIZE; y += 1) for (let x = 0; x < AVATAR_SIZE; x += 1) {
    if (!inside(x, y)) continue;
    if (!inside(x - 1, y) || !inside(x, y - 1) || !inside(x + 1, y) || !inside(x, y + 1)) { put(x, y + top, ramp.edge); continue; }
    if (y <= 13 && y >= 4 && (!inside(x + 3, y) || !inside(x, y + 2))) { put(x, y + top, ramp.side); continue; } // extruded right (2 px) and bottom (1 px) side
    // Light from the top left: a solid lit corner, then a checker that fades into the base.
    const d = x - 2 + (y - 3);
    put(x, y + top, d < 4 || (d < 9 && ((x + y) & 1) === 0) ? ramp.light : ramp.base);
  }
  put(4, 5 + top, ramp.shine); put(5, 5 + top, ramp.shine); put(4, 6 + top, ramp.shine); // catch-light
  for (const [x, y, shade] of eyePixels(look.eyes, pose)) put(x, y + top, shade ? ramp.eyeShade : ramp.eye);
  for (const [ink, x, y, w, h] of ACCESSORIES[look.accessory]) put(x, y + top, ink === "E" ? ramp.edge : ACCESSORY_INK[ink]!, w, h);
  if (pose.state === "waiting") { put(12, 0, ramp.notchDark, 4, 4); put(13, 0, ramp.notchLight, 3, 3); }
  return out;
}
