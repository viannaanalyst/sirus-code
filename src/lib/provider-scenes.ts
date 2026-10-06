import type { AgentProviderId } from "@/client/types";

/**
 * Canvas drawing for the provider switch scene: the new provider's logo builds
 * itself from blocks over a pixel grid, each provider moving its blocks its own
 * way, then fades out. Pure drawing; `ProviderSwitchScene` owns the loop.
 */

type Rgb = readonly [number, number, number];

/** Glow tint and the colours of the blinking pixels around the logo. */
const LOOK: Record<AgentProviderId, { tint: Rgb; pixels: string[] }> = {
  claude: { tint: [217, 119, 87], pixels: ["#D97757", "#F0A887", "#B85A3E"] },
  codex: { tint: [116, 170, 156], pixels: ["#74AA9C", "#A8D5C8", "#3F7F6F"] },
  opencode: { tint: [214, 214, 222], pixels: ["#D6D6DE", "#8A8A92", "#5A5858"] },
  grok: { tint: [226, 228, 255], pixels: ["#E2E4FF", "#9AA0C8", "#FFFFFF"] },
  cursor: { tint: [169, 184, 214], pixels: ["#A9B8D6", "#E4E9F2", "#6B7A99"] },
  antigravity: { tint: [127, 168, 255], pixels: ["#3186FF", "#00B95C", "#FBBC04", "#FC413D"] },
  droid: { tint: [242, 165, 65], pixels: ["#F2A541", "#FFD08A", "#B87420"] },
  pi: { tint: [240, 144, 130], pixels: ["#F09082", "#4D9ABF", "#F1BE58"] },
  devin: { tint: [95, 179, 249], pixels: ["#5FB3F9", "#B9DEFF", "#2E7BC0"] },
};

export const SCENE_LIFETIME = 5000;

const rgba = ([r, g, b]: Rgb, a: number) => `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => 1 - Math.pow(1 - clamp(x), 3);

/** Visibility over the scene's life: in over 0.5 s, hold, out between 4 s and 5 s. */
export function sceneLevel(age: number) {
  if (age >= SCENE_LIFETIME || age < 0) return 0;
  if (age < 500) return ease(age / 500);
  if (age < 4000) return 1;
  return 1 - ease((age - 4000) / 1000);
}

interface Tile { row: number; col: number; ox: number; oy: number; dist: number; r: number; delay: number; place: (k: number) => Pose }
interface Pose { dx: number; dy: number; rot: number; sc: number }

const N = 8;

/** How each provider brings its tiles in. Offsets are in scene units (R); k runs 0 → 1. */
function style(provider: AgentProviderId, tile: Omit<Tile, "delay" | "place">): Pick<Tile, "delay" | "place"> {
  const { ox, oy, r, row, col, dist } = tile;
  const angle = Math.atan2(oy, ox), radius = Math.hypot(ox, oy);
  switch (provider) {
    case "claude": // Rays converging on the centre.
      return { delay: r * .3, place: (k) => ({ dx: Math.cos(angle) * 5 * (1 - k), dy: Math.sin(angle) * 5 * (1 - k), rot: (r - .5) * 3 * (1 - k), sc: 1 }) };
    case "codex": // A spiral.
      return { delay: dist * .35, place: (k) => { const a = angle + (1 - k) * 4, d = radius + (1 - k) * 4.5; return { dx: Math.cos(a) * d - ox, dy: Math.sin(a) * d - oy, rot: (1 - k) * 4, sc: .5 + .5 * k }; } };
    case "opencode": // Typed in, row by row.
      return { delay: (row * N + col) / (N * N) * .55, place: (k) => ({ dx: 0, dy: -(1 - k) * .6, rot: 0, sc: k < .3 ? 1.3 : 1 }) };
    case "grok": // Pulled in along a flattened orbit that rounds out as each tile lands.
      return { delay: r * .35, place: (k) => { const a = angle - (1 - k) * 7, d = radius + (1 - k) * 6, flat = .45 + .55 * k; return { dx: Math.cos(a) * d - ox, dy: Math.sin(a) * d * flat - oy, rot: -(1 - k) * 6, sc: .3 + .7 * k }; } };
    case "cursor": // Columns falling from above.
      return { delay: col / N * .4 + r * .08, place: (k) => ({ dx: 0, dy: -(1 - k) * 6, rot: (1 - k) * 1.2 * (col % 2 ? 1 : -1), sc: 1 }) };
    case "antigravity": // Rising from below.
      return { delay: (N - 1 - row) / N * .4 + r * .08, place: (k) => ({ dx: Math.sin((1 - k) * 6 + col) * .5 * (1 - k), dy: (1 - k) * 6, rot: (1 - k) * (r - .5) * 2, sc: 1 }) };
    case "droid": // A conveyor from the left.
      return { delay: col / N * .45, place: (k) => ({ dx: -(1 - k) * 8, dy: Math.abs(Math.sin((1 - k) * 9)) * -.4 * (1 - k), rot: 0, sc: 1 }) };
    default: // Devin (and any later provider): expanding from the centre.
      return { delay: dist * .45, place: (k) => ({ dx: -ox * (1 - k), dy: -oy * (1 - k), rot: 0, sc: k }) };
  }
}

/** Pi's three logo blocks (from its mark's paths), which fly in whole. */
const PI_VIEWBOX = [165, 165, 470, 470] as const;
const PI_BLOCKS = [
  { d: "M165.29 165.29H517.36V400H400V282.65H165.29Z", fill: "#F09082", from: [-2.4, -1.6, -1.2] },
  { d: "M165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29Z", fill: "#4D9ABF", from: [2.2, 1.9, 1.4] },
  { d: "M517.36 400H634.72V634.72H517.36Z", fill: "#F1BE58", from: [2.6, -2.1, -1.6] },
] as const;

export interface SceneFrame { ctx: CanvasRenderingContext2D; width: number; height: number; dpr: number; light: boolean }

export interface ProviderScene { draw: (frame: SceneFrame, age: number, now: number) => void }

/**
 * `mark` is the provider's logo image; `monochrome` marks are white and are
 * recoloured to ink on light themes.
 */
export function createProviderScene(provider: AgentProviderId, mark: HTMLImageElement, monochrome: boolean): ProviderScene {
  const look = LOOK[provider];
  const tiles: Tile[] = [];
  for (let row = 0; row < N; row += 1) for (let col = 0; col < N; col += 1) {
    const ox = col - (N - 1) / 2, oy = row - (N - 1) / 2;
    const base = { row, col, ox, oy, dist: Math.hypot(ox, oy) / Math.hypot(N / 2, N / 2), r: Math.random() };
    tiles.push({ ...base, ...style(provider, base) });
  }
  const pixels = Array.from({ length: 46 }, () => ({ gx: Math.floor(Math.random() * 30), gy: Math.floor(Math.random() * 20), c: Math.floor(Math.random() * 4), p: Math.random() * 6.28 }));
  const stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.1 + .2, p: Math.random() * 6.28 }));
  const shooting = Array.from({ length: 6 }, (_, index) => ({ x: Math.random() * .85, y: .4 + Math.random() * .55, delay: index * 260 + Math.random() * 400, speed: .00028 + Math.random() * .00018 }));
  let tilesCanvas: HTMLCanvasElement | null = null, tilesSize = 0, tilesLight = false;
  const piPaths = PI_BLOCKS.map((block) => new Path2D(block.d));

  const logoCanvas = (px: number, light: boolean) => {
    if (tilesCanvas && tilesSize === px && tilesLight === light) return tilesCanvas;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = px;
    const c = canvas.getContext("2d");
    if (c && mark.naturalWidth) {
      const ratio = mark.naturalWidth / mark.naturalHeight || 1;
      const w = ratio >= 1 ? px : px * ratio, h = ratio >= 1 ? px / ratio : px;
      c.drawImage(mark, (px - w) / 2, (px - h) / 2, w, h);
      if (monochrome && light) { c.globalCompositeOperation = "source-in"; c.fillStyle = "#1a1a1a"; c.fillRect(0, 0, px, px); }
    }
    tilesCanvas = canvas; tilesSize = px; tilesLight = light;
    return canvas;
  };

  return {
    draw({ ctx, width, height, dpr, light }, age, now) {
      const L = sceneLevel(age);
      if (L <= 0) return;
      const e = clamp(age / 1500);
      const ink: Rgb = light ? [0, 0, 0] : [255, 255, 255];
      const x = width * .8, y = height * .2, R = Math.min(width, height) * .06, size = R * 3.2;

      // Stars and shooting stars across the whole column.
      for (const star of stars) {
        ctx.fillStyle = rgba(ink, (.2 + .3 * Math.sin(now / 900 + star.p)) * L * (light ? .5 : 1));
        ctx.beginPath(); ctx.arc(star.x * width, star.y * height, star.r, 0, 6.283); ctx.fill();
      }
      for (const star of shooting) {
        const k = (age - star.delay) * star.speed;
        if (k <= 0 || k >= 1) continue;
        const sx = (star.x + k * .35) * width, sy = (star.y - k * .6) * height;
        const tail = ctx.createLinearGradient(sx, sy, sx - .35 * width * .08, sy + .6 * height * .08);
        tail.addColorStop(0, rgba(look.tint, .9 * Math.sin(Math.PI * k) * L)); tail.addColorStop(1, rgba(look.tint, 0));
        ctx.strokeStyle = tail; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - .35 * width * .08, sy + .6 * height * .08); ctx.stroke();
      }

      // Pixel grid with blinking pixels in the provider's colours.
      const cell = R * .62;
      ctx.strokeStyle = rgba(ink, .035 * L); ctx.lineWidth = 1;
      for (let gx = -8; gx <= 8; gx += 1) { ctx.beginPath(); ctx.moveTo(x + gx * cell, y - cell * 6); ctx.lineTo(x + gx * cell, y + cell * 6); ctx.stroke(); }
      for (let gy = -6; gy <= 6; gy += 1) { ctx.beginPath(); ctx.moveTo(x - cell * 8, y + gy * cell); ctx.lineTo(x + cell * 8, y + gy * cell); ctx.stroke(); }
      for (const pixel of pixels) {
        const a = Math.max(0, Math.sin(now / 700 + pixel.p)) * .5 * L * ease(e);
        const px = x + (pixel.gx - 15) * cell * .55, py = y + (pixel.gy - 10) * cell * .55;
        if (Math.hypot(px - x, py - y) < size * .62) continue;
        ctx.globalAlpha = a;
        ctx.fillStyle = look.pixels[pixel.c % look.pixels.length];
        ctx.fillRect(px, py, cell * .42, cell * .42);
      }
      ctx.globalAlpha = 1;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, R * 6);
      glow.addColorStop(0, rgba(look.tint, (light ? .12 : .2) * L)); glow.addColorStop(1, rgba(look.tint, 0));
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, R * 6, 0, 6.283); ctx.fill();

      const bob = Math.sin(now / 1000) * R * .06 * ease(e);
      if (provider === "pi") {
        const [vx, vy, vw, vh] = PI_VIEWBOX, scale = size / vh;
        PI_BLOCKS.forEach((block, index) => {
          const k = ease(clamp(e * 1.35 - index * .14));
          if (k <= 0) return;
          const [fx, fy, rot] = block.from;
          ctx.save();
          ctx.translate((1 - k) * fx * R * 2.4, (1 - k) * fy * R * 2.4 + bob + Math.sin(now / 900 + index * 2.1) * R * .06 * k);
          ctx.translate(x, y); ctx.rotate((1 - k) * rot); ctx.translate(-x, -y);
          ctx.translate(x - (vx + vw / 2) * scale, y - (vy + vh / 2) * scale); ctx.scale(scale, scale);
          ctx.globalAlpha = k * L;
          ctx.fillStyle = block.fill; ctx.fill(piPaths[index]);
          ctx.restore();
        });
      } else if (mark.complete && mark.naturalWidth) {
        const px = Math.round(size * dpr), source = logoCanvas(px, light);
        const ts = size / N, sp = px / N;
        for (const tile of tiles) {
          const k = ease(clamp(e * 1.5 - tile.delay));
          if (k <= 0) continue;
          const pose = tile.place(k), gap = (1 - k) * ts * .14;
          ctx.save();
          ctx.translate(x - size / 2 + tile.col * ts + ts / 2 + pose.dx * R, y - size / 2 + tile.row * ts + ts / 2 + pose.dy * R + bob);
          ctx.rotate(pose.rot); ctx.scale(pose.sc, pose.sc);
          ctx.globalAlpha = Math.min(1, k * 1.6) * L;
          ctx.drawImage(source, tile.col * sp, tile.row * sp, sp, sp, -ts / 2 + gap, -ts / 2 + gap, ts - gap * 2 + .6, ts - gap * 2 + .6);
          ctx.restore();
        }
      }
      // A frame flashes once the last block lands.
      const flash = provider === "pi" ? .55 : .86;
      if (e > flash && e < 1) {
        ctx.strokeStyle = rgba(ink, .7 * (1 - e) / (1 - flash));
        ctx.lineWidth = 2;
        ctx.strokeRect(x - size / 2 - 6, y - size / 2 - 6 + bob, size + 12, size + 12);
      }
    },
  };
}
