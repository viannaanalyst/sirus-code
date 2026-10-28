/**
 * Project avatars (ADR-175): a 12x12 pixel speech bubble with a face, drawn pixel by pixel into
 * a buffer. Everything here is pure: the colour ramp (a hex colour turned into role colours in
 * OKLCH with hue shifts), the deterministic defaults from the project name, and the sprite
 * (mask, shading, face layers). `components/ProjectAvatar.tsx` paints the buffer on a canvas and
 * `avatar-scheduler.ts` decides when to repaint.
 */
import type { ProjectAppearance } from "@/client/types";

export const AVATAR_SIZE = 12;
/** One spare row under the sprite, for the two-frame bob. */
export const AVATAR_ROWS = 13;

export const AVATAR_EYES = ["dot", "round", "wide", "sleepy"] as const;
export const AVATAR_MOUTHS = ["smile", "o", "flat"] as const;
export type AvatarEyes = (typeof AVATAR_EYES)[number];
export type AvatarMouth = (typeof AVATAR_MOUTHS)[number];
export type AvatarState = "idle" | "working" | "waiting";
export type AvatarGaze = -1 | 0 | 1;

export interface AvatarLook { color: string; eyes: AvatarEyes; mouth: AvatarMouth; cheeks: boolean }
/** One frame of the animation: what moves, not how it is drawn. */
export interface AvatarPose { state: AvatarState; blink: boolean; gaze: AvatarGaze; bob: boolean; talk: boolean }

export const AVATAR_SWATCHES = ["#8b7cf6", "#5b8def", "#38bdf8", "#2dd4bf", "#4ade80", "#a3c94a", "#facc15", "#fb923c", "#f87171", "#f472b6", "#c084fc", "#94a3b8"] as const;

export const RESTING_POSE: AvatarPose = { state: "idle", blink: false, gaze: 0, bob: false, talk: false };

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

export interface AvatarRamp { outline: Rgba; shadow: Rgba; base: Rgba; light: Rgba; shine: Rgba; white: Rgba; cheek: Rgba; notchDark: Rgba; notchLight: Rgba }

/**
 * Roles, not pixels: a new colour only rebuilds this ramp. Shadows drift cool (towards blue) and
 * lights warm (towards yellow), the way hand-drawn pixel art shifts hue instead of only lightness.
 */
export function avatarRamp(hex: string): AvatarRamp {
  const { c, h } = hexToOklch(hex);
  const chroma = Math.max(0.04, Math.min(0.17, c));
  const k = (x: number) => Math.max(0.02, chroma * x);
  return {
    outline: oklchToRgba(0.29, k(0.5), hueToward(h, 265, 0.35)),
    shadow: oklchToRgba(0.52, k(0.9), hueToward(h, 265, 0.18)),
    base: oklchToRgba(0.67, k(1), h),
    light: oklchToRgba(0.79, k(0.8), hueToward(h, 85, 0.12)),
    shine: oklchToRgba(0.95, k(0.3), hueToward(h, 85, 0.25)),
    white: oklchToRgba(0.98, 0.01, hueToward(h, 85, 0.2)),
    cheek: oklchToRgba(0.74, 0.13, hueToward(h, 10, 0.7)),
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

/** The look every project has with no setup: stable, taken from the name. */
export function defaultLook(name: string): AvatarLook {
  const h = hashName(name);
  return { color: AVATAR_SWATCHES[h % AVATAR_SWATCHES.length]!, eyes: AVATAR_EYES[(h >>> 4) % AVATAR_EYES.length]!, mouth: AVATAR_MOUTHS[(h >>> 8) % AVATAR_MOUTHS.length]!, cheeks: ((h >>> 12) & 1) === 1 };
}

const HEX = /^#[0-9a-f]{6}$/i;
export const isAvatarColor = (value: unknown): value is string => typeof value === "string" && HEX.test(value);

/** The saved choices over the defaults; a value the app does not know falls back to the default. */
export function resolveLook(name: string, appearance?: Partial<ProjectAppearance> | null): AvatarLook {
  const base = defaultLook(name);
  if (!appearance) return base;
  return {
    color: isAvatarColor(appearance.color) ? appearance.color.toLowerCase() : base.color,
    eyes: (AVATAR_EYES as readonly string[]).includes(appearance.eyes ?? "") ? appearance.eyes as AvatarEyes : base.eyes,
    mouth: (AVATAR_MOUTHS as readonly string[]).includes(appearance.mouth ?? "") ? appearance.mouth as AvatarMouth : base.mouth,
    cheeks: typeof appearance.cheeks === "boolean" ? appearance.cheeks : base.cheeks,
  };
}

/** A random look for "Shuffle". `random` is injectable for tests. */
export function shuffleLook(random: () => number = Math.random): AvatarLook {
  const pick = <T,>(list: readonly T[]) => list[Math.min(list.length - 1, Math.floor(random() * list.length))]!;
  return { color: pick(AVATAR_SWATCHES), eyes: pick(AVATAR_EYES), mouth: pick(AVATAR_MOUTHS), cheeks: random() > 0.5 };
}

export const lookKey = (look: AvatarLook) => `${look.color}|${look.eyes}|${look.mouth}|${look.cheeks ? 1 : 0}`;

// ---------------------------------------------------------------------------------------------
// Animation frames

/** Pointer within reach of an avatar looks left or right; `dx`/`dy` are from the avatar's centre. */
export function gazeToward(dx: number, dy: number): AvatarGaze {
  if (Math.abs(dy) >= 240 || Math.abs(dx) >= 300) return 0;
  return dx > 18 ? 1 : dx < -18 ? -1 : 0;
}

/** Working, at one tick (about 200 ms): the bob every second tick, the mouth every tick, a glance every fourth. */
export function workingPose(tick: number): AvatarPose {
  return { state: "working", blink: false, gaze: ([0, 1, 0, -1] as const)[Math.floor(tick / 4) % 4]!, bob: Math.floor(tick / 2) % 2 === 1, talk: tick % 2 === 1 };
}

export const poseKey = (pose: AvatarPose) => `${pose.state}${pose.blink ? "b" : ""}${pose.gaze}${pose.bob ? "u" : ""}${pose.talk ? "t" : ""}`;

// ---------------------------------------------------------------------------------------------
// Sprite

const MASK = ["..########..", ".##########.", "############", "############", "############", "############", "############", "############", ".##########.", "..########..", ".##.........", "##........."];
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]] as const;

const inside = (x: number, y: number) => y >= 0 && y < AVATAR_SIZE && x >= 0 && x < AVATAR_SIZE && MASK[y]![x] === "#";
const edge = (x: number, y: number) => inside(x, y) && (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1));

/** Which pixels the face lights for this pose; the cheeks are separate. */
export function faceMarks(look: Pick<AvatarLook, "eyes" | "mouth">, pose: AvatarPose): Array<[number, number]> {
  const marks: Array<[number, number]> = [];
  const happy = pose.state === "waiting";
  const ey = 5;
  const gx = pose.gaze;
  for (const ex of [3, 7]) {
    if (pose.blink || look.eyes === "sleepy") { marks.push([ex, ey], [ex + 1, ey]); continue; }
    if (happy) { marks.push([ex, ey], [ex + 1, ey - 1]); continue; } // the ^ ^ eyes
    if (look.eyes === "dot") { const x = ex + (gx > 0 ? 1 : 0); marks.push([x, ey - 1], [x, ey]); }
    else if (look.eyes === "round") { const o = gx; marks.push([ex + o, ey - 1], [ex + 1 + o, ey - 1], [ex + o, ey], [ex + 1 + o, ey]); }
    else { const o = gx > 0 ? 1 : 0; marks.push([ex + o, ey - 1], [ex + o, ey], [ex + 1 + o, ey]); }
  }
  const mouth = happy ? "smile" : pose.state === "working" ? (pose.talk ? "o" : "flat") : look.mouth;
  if (mouth === "smile") marks.push([5, 7], [6, 7], [4, 6], [7, 6]);
  else if (mouth === "o") marks.push([5, 6], [6, 6], [5, 7], [6, 7]);
  else marks.push([5, 7], [6, 7]);
  return marks;
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
 * The avatar as RGBA bytes, `12k` by `13k` pixels (each sprite pixel is a `k`-by-`k` block, so the
 * result is already at an exact integer scale). Transparent where nothing is drawn.
 */
export function renderAvatar(look: AvatarLook, pose: AvatarPose = RESTING_POSE, k = 1): Uint8ClampedArray<ArrayBuffer> {
  const width = AVATAR_SIZE * k;
  const out = new Uint8ClampedArray(width * AVATAR_ROWS * k * 4);
  const ramp = rampFor(look.color);
  const put = (x: number, y: number, color: Rgba) => {
    if (x < 0 || x >= AVATAR_SIZE || y < 0 || y >= AVATAR_ROWS) return;
    for (let dy = 0; dy < k; dy += 1) for (let dx = 0; dx < k; dx += 1) {
      const at = ((y * k + dy) * width + x * k + dx) * 4;
      out[at] = color[0]; out[at + 1] = color[1]; out[at + 2] = color[2]; out[at + 3] = color[3];
    }
  };
  const top = pose.state === "working" && pose.bob ? 0 : 1; // the body rests one row down, the hop lifts it
  const body = (x: number, y: number, color: Rgba) => put(x, y + top, color);
  for (let y = 0; y < AVATAR_SIZE; y += 1) for (let x = 0; x < AVATAR_SIZE; x += 1) {
    if (!inside(x, y)) continue;
    if (edge(x, y)) { body(x, y, ramp.outline); continue; }
    const v = ((x + y) / 18) * 3;
    const tone = Math.floor(v);
    const step = Math.min(2, tone + (v - tone > BAYER[y & 3]![x & 3]! / 16 ? 1 : 0));
    body(x, y, [ramp.light, ramp.base, ramp.shadow][step]!);
  }
  body(2, 2, ramp.shine); body(3, 2, ramp.shine); body(2, 3, ramp.shine);
  // Features are white with a one-pixel drop shadow in the bubble's outline tone; no black ink.
  const marks = faceMarks(look, pose);
  const lit = new Set(marks.map(([x, y]) => `${x},${y}`));
  for (const [x, y] of marks) if (!lit.has(`${x + 1},${y + 1}`) && inside(x + 1, y + 1) && !edge(x + 1, y + 1)) body(x + 1, y + 1, ramp.outline);
  for (const [x, y] of marks) body(x, y, ramp.white);
  if (look.cheeks || pose.state === "waiting") { body(2, 7, ramp.cheek); body(9, 7, ramp.cheek); }
  if (pose.state === "waiting") {
    for (let y = 0; y < 3; y += 1) for (let x = 9; x < 12; x += 1) put(x, y, ramp.notchDark);
    for (let y = 0; y < 2; y += 1) for (let x = 10; x < 12; x += 1) put(x, y, ramp.notchLight);
  }
  return out;
}
