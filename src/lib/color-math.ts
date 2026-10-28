// Small colour helpers for imported themes (ADR-185): hex parsing, blending, WCAG contrast and a
// lightness adjustment in OKLCH that keeps hue and chroma, so a guarded colour still looks like
// the theme's colour.

export interface Rgba { r: number; g: number; b: number; a: number }

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`; null for anything else. */
export function parseColor(value: string | undefined | null): Rgba | null {
  if (!value) return null;
  const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!match) return null;
  let digits = match[1];
  if (digits.length <= 4) digits = [...digits].map((digit) => digit + digit).join("");
  const channel = (start: number) => Number.parseInt(digits.slice(start, start + 2), 16);
  return { r: channel(0), g: channel(2), b: channel(4), a: digits.length === 8 ? channel(6) / 255 : 1 };
}

const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const hex2 = (value: number) => byte(value).toString(16).padStart(2, "0");

/** `#rrggbb`, or `#rrggbbaa` when the colour is not opaque. */
export function formatColor({ r, g, b, a }: Rgba): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(a * 255) : ""}`;
}

export function withAlpha(color: Rgba, alpha: number): Rgba {
  return { ...color, a: Math.max(0, Math.min(1, alpha)) };
}

/** `color` painted over an opaque `backdrop`. */
export function flatten(color: Rgba, backdrop: Rgba): Rgba {
  const a = color.a;
  return { r: color.r * a + backdrop.r * (1 - a), g: color.g * a + backdrop.g * (1 - a), b: color.b * a + backdrop.b * (1 - a), a: 1 };
}

/** `amount` (0 to 1) of `toward` mixed into `from`, both treated as opaque. */
export function mix(from: Rgba, toward: Rgba, amount: number): Rgba {
  return { r: from.r + (toward.r - from.r) * amount, g: from.g + (toward.g - from.g) * amount, b: from.b + (toward.b - from.b) * amount, a: 1 };
}

const linear = (channel: number) => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

export function luminance(color: Rgba): number {
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

/** WCAG contrast ratio between two opaque colours (1 to 21). */
export function contrast(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

interface Oklch { l: number; c: number; h: number }

function toOklch({ r, g, b }: Rgba): Oklch {
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) };
}

function fromOklch({ l: L, c, h }: Oklch): Rgba {
  const A = c * Math.cos(h);
  const B = c * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const encode = (value: number) => {
    const clamped = Math.max(0, Math.min(1, value));
    return 255 * (clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055);
  };
  return {
    r: encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: 1,
  };
}

/**
 * `color` moved along OKLCH lightness (hue and chroma kept) away from the backdrop(s) until it has
 * `minimum` contrast on every one of them. A colour already readable is returned as it came; one
 * that cannot get there ends at white or black, whichever the backdrops allow.
 */
export function ensureContrast(color: Rgba, backdrop: Rgba | readonly Rgba[], minimum: number): Rgba {
  const backdrops: readonly Rgba[] = Array.isArray(backdrop) ? backdrop : [backdrop as Rgba];
  const worst = (candidate: Rgba) => Math.min(...backdrops.map((back) => contrast(candidate, back)));
  const opaque = { ...color, a: 1 };
  if (worst(opaque) >= minimum) return opaque;
  const lch = toOklch(opaque);
  // White contrasts more than black on a backdrop darker than this luminance (about 0.179).
  const lighten = backdrops.reduce((sum, back) => sum + luminance(back), 0) / backdrops.length < 0.179;
  const step = lighten ? 0.01 : -0.01;
  for (let l = lch.l + step; l >= 0 && l <= 1; l += step) {
    const candidate = fromOklch({ ...lch, l });
    if (worst(candidate) >= minimum) return candidate;
  }
  return lighten ? { r: 255, g: 255, b: 255, a: 1 } : { r: 0, g: 0, b: 0, a: 1 };
}
