/**
 * Chat background effects (ADR-089, after MonoCode). Dither, ASCII and Halftone are
 * drawn once into a new image on a canvas; Scanlines and Haze are CSS over the original.
 */
export const BACKGROUND_EFFECTS = ["none", "dither", "ascii", "halftone", "scanlines", "haze"] as const;
export type BackgroundEffect = (typeof BACKGROUND_EFFECTS)[number];

/** Effects that redraw the image; the rest are applied in CSS. */
export const CANVAS_EFFECTS: readonly BackgroundEffect[] = ["dither", "ascii", "halftone"];

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

const cache = new Map<string, Promise<string>>();
/** The image drawn with a canvas effect, as a data URL (cached per source and effect). */
export function renderBackgroundEffect(source: string, effect: BackgroundEffect): Promise<string> {
  if (!CANVAS_EFFECTS.includes(effect)) return Promise.resolve(source);
  const key = `${effect}:${source.length}:${source.slice(-64)}`;
  let result = cache.get(key);
  if (!result) {
    result = draw(source, effect).catch(() => source);
    cache.set(key, result);
  }
  return result;
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
  return { width, height, pixels: context.getImageData(0, 0, width, height).data };
}

async function draw(source: string, effect: BackgroundEffect): Promise<string> {
  const image = await load(source);
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
    return output.toDataURL("image/png");
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
    return output.toDataURL("image/png");
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
  return output.toDataURL("image/png");
}
