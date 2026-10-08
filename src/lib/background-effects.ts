/**
 * Chat background effects (ADR-089, after MonoCode). Dither, ASCII, Halftone and Haze
 * are drawn once into a new image on a canvas; Scanlines is CSS over the original.
 * Images are handed to CSS as short `blob:` URLs, never as multi-MB data URLs.
 */
export const BACKGROUND_EFFECTS = ["none", "dither", "ascii", "halftone", "scanlines", "haze"] as const;
export type BackgroundEffect = (typeof BACKGROUND_EFFECTS)[number];

/** Effects that redraw the image; the rest are applied in CSS. */
export const CANVAS_EFFECTS: readonly BackgroundEffect[] = ["dither", "ascii", "halftone", "haze"];

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Ordered (Bayer 4×4) dithering of one 0–255 channel to `levels` steps. */
export function ditherChannel(value: number, x: number, y: number, levels = 4): number {
  const step = 255 / (levels - 1);
  const threshold = (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16 - 0.5;
  const level = Math.round(value / step + threshold);
  return Math.max(0, Math.min(255, Math.round(Math.max(0, Math.min(levels - 1, level)) * step)));
}

const RAMP = " .:-=+*#%@";
/** The character for a 0–1 luminance, from blank to dense. */
export function asciiChar(luminance: number): string {
  return RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.floor(luminance * RAMP.length)))];
}

export const luminance = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** The Haze tone: CSS `saturate(1.2) brightness(1.08)` on one pixel, for canvases without `ctx.filter`. */
export function hazeTone(r: number, g: number, b: number, saturate = 1.2, brightness = 1.08): [number, number, number] {
  const s = saturate;
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value * brightness)));
  return [
    clamp((0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b),
    clamp((0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b),
    clamp((0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b),
  ];
}

/** A `data:` URL decoded to a Blob without going through fetch (CSP keeps connect-src narrow). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const header = dataUrl.slice(5, comma);
  const type = header.split(";")[0] || "application/octet-stream";
  const body = dataUrl.slice(comma + 1);
  if (!header.endsWith(";base64")) return new Blob([decodeURIComponent(body)], { type });
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

/** A small LRU of blob URLs; evicted entries are revoked so their images can be freed. */
export function createBlobUrlCache(limit: number, revoke: (url: string) => void = (url) => URL.revokeObjectURL(url)) {
  const entries = new Map<string, Promise<string>>();
  const release = (result: Promise<string>) => { void result.then((url) => { if (url.startsWith("blob:")) revoke(url); }, () => undefined); };
  return {
    get(key: string, make: () => Promise<string>): Promise<string> {
      let result = entries.get(key);
      if (result) {
        entries.delete(key);
      } else {
        result = make();
        // A failed render is not kept, so the next attempt tries again.
        result.catch(() => { if (entries.get(key) === result) entries.delete(key); });
      }
      entries.set(key, result);
      while (entries.size > limit) {
        const [oldest, value] = entries.entries().next().value as [string, Promise<string>];
        entries.delete(oldest);
        release(value);
      }
      return result;
    },
    clear() {
      for (const value of entries.values()) release(value);
      entries.clear();
    },
    get size() { return entries.size; },
  };
}

// The shown image plus one more, so flipping back to the previous choice stays instant.
const cache = createBlobUrlCache(2);

/**
 * The chat background drawn with its effect, as a `blob:` URL (cached per source and
 * effect, at most two kept). `source` is the image as a data URL.
 */
export function renderBackgroundEffect(source: string, effect: BackgroundEffect): Promise<string> {
  const key = `${effect}:${source.length}:${source.slice(-64)}`;
  return cache.get(key, async () => {
    const original = dataUrlToBlob(source);
    if (!CANVAS_EFFECTS.includes(effect)) return URL.createObjectURL(original);
    const input = URL.createObjectURL(original);
    try {
      return URL.createObjectURL(await draw(input, effect));
    } catch {
      return URL.createObjectURL(original);
    } finally {
      URL.revokeObjectURL(input);
    }
  });
}

/** Frees every cached background (the background was turned off). */
export function releaseBackgroundEffects() {
  cache.clear();
}

/** Exports the canvas, then frees its backing store (a 2560 px canvas holds ~15 MB until GC). */
function toBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    release(canvas);
    if (blob) resolve(blob); else reject(new Error("Canvas export failed"));
  }, type, quality));
}

function release(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

function load(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

/** The image scaled to `width` columns, as raw pixels. */
function sample(image: HTMLImageElement, width: number, squash = 1) {
  const height = Math.max(1, Math.round((image.naturalHeight / image.naturalWidth) * width * squash));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  release(canvas);
  return { width, height, pixels };
}

async function draw(source: string, effect: BackgroundEffect): Promise<Blob> {
  const image = await load(source);
  if (effect === "haze") return haze(image);
  const output = document.createElement("canvas");
  const context = output.getContext("2d")!;
  if (effect === "dither") {
    const { width, height, pixels } = sample(image, 480);
    const small = document.createElement("canvas");
    small.width = width;
    small.height = height;
    const data = new ImageData(width, height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) data.data[index + channel] = ditherChannel(pixels[index + channel], x, y);
        data.data[index + 3] = 255;
      }
    }
    small.getContext("2d")!.putImageData(data, 0, 0);
    output.width = width * 3;
    output.height = height * 3;
    context.imageSmoothingEnabled = false;
    context.drawImage(small, 0, 0, output.width, output.height);
    release(small);
    return toBlob(output);
  }
  if (effect === "ascii") {
    const cell = 10;
    const { width, height, pixels } = sample(image, 180, 0.5);
    output.width = width * cell;
    output.height = height * cell * 2;
    context.fillStyle = "#000";
    context.fillRect(0, 0, output.width, output.height);
    context.font = `${cell * 1.6}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.textBaseline = "top";
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const [r, g, b] = [pixels[index], pixels[index + 1], pixels[index + 2]];
        const char = asciiChar(luminance(r, g, b));
        if (char === " ") continue;
        context.fillStyle = `rgb(${r} ${g} ${b})`;
        context.fillText(char, x * cell, y * cell * 2);
      }
    }
    return toBlob(output);
  }
  // Halftone: one dot per cell, its size following the cell's brightness.
  const cell = 9;
  const { width, height, pixels } = sample(image, 200);
  output.width = width * cell;
  output.height = height * cell;
  context.fillStyle = "#000";
  context.fillRect(0, 0, output.width, output.height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const [r, g, b] = [pixels[index], pixels[index + 1], pixels[index + 2]];
      const radius = (cell / 2) * Math.sqrt(luminance(r, g, b)) * 1.05;
      if (radius < 0.4) continue;
      context.fillStyle = `rgb(${r} ${g} ${b})`;
      context.beginPath();
      context.arc(x * cell + cell / 2, y * cell + cell / 2, radius, 0, Math.PI * 2);
      context.fill();
    }
  }
  return toBlob(output);
}

/**
 * Haze, drawn once: the image at about the display's size (not its full resolution),
 * blurred 14px and lifted, as the CSS filter used to do on every repaint.
 */
async function haze(image: HTMLImageElement): Promise<Blob> {
  const display = typeof screen !== "undefined" ? Math.max(screen.width, screen.height) : 1920;
  const width = Math.max(1, Math.min(image.naturalWidth, display || 1920));
  const height = Math.max(1, Math.round((image.naturalHeight / image.naturalWidth) * width));
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const context = output.getContext("2d")!;
  if (typeof context.filter === "string") {
    context.filter = "blur(14px) saturate(1.2) brightness(1.08)";
    // Drawn a little past the edges so the blur does not fade them to transparent (black in JPEG).
    const pad = 28;
    context.drawImage(image, -pad, -pad, width + pad * 2, height + pad * 2);
    if (context.filter !== "none") return toBlob(output, "image/jpeg", 0.9);
  }
  // No canvas filters: blur by scaling down and back up, then tone each pixel.
  context.filter = "none";
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.round(width / 10));
  small.height = Math.max(1, Math.round(height / 10));
  const smallContext = small.getContext("2d")!;
  smallContext.imageSmoothingQuality = "high";
  smallContext.drawImage(image, 0, 0, small.width, small.height);
  const pixels = smallContext.getImageData(0, 0, small.width, small.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const [r, g, b] = hazeTone(pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]);
    pixels.data[index] = r;
    pixels.data[index + 1] = g;
    pixels.data[index + 2] = b;
  }
  smallContext.putImageData(pixels, 0, 0);
  context.imageSmoothingQuality = "high";
  context.drawImage(small, 0, 0, width, height);
  release(small);
  return toBlob(output, "image/jpeg", 0.9);
}
