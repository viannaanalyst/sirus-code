import type { AstroIconId } from "@/client/types";

/**
 * Pixel-style Astro icons (ADR-069): real 12×12 sprites with two frames each,
 * drawn from simple shapes into a grid of palette letters, then given a shared
 * dark outline. Built with the pixel-art-sprites guidance: one light direction
 * (top-left), a hue-shifted ramp (cooler shadows, warmer lights), hard edges,
 * no anti-aliasing, few frames and integer scaling.
 *
 * Letters: o outline, d shadow, b base, l light, w highlight (the ramp of the
 * Astro's colour), y gold, r ember, k void, s silver, g iron, . empty.
 */
export const SPRITE_SIZE = 12;
export type Sprite = readonly string[];

type Grid = string[][];
const N = SPRITE_SIZE;
const blank = (): Grid => Array.from({ length: N }, () => Array<string>(N).fill("."));
const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N;
const put = (grid: Grid, x: number, y: number, letter: string) => { if (inside(x, y)) grid[y][x] = letter; };
const each = (fn: (x: number, y: number, px: number, py: number) => void) => {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) fn(x, y, x + 0.5, y + 0.5);
};

/** Lit from the top-left: the normal's facing picks a ramp step. */
function shade(nx: number, ny: number, nz: number, ramp = "wlbd") {
  const light = -0.55 * nx - 0.6 * ny + 0.58 * nz;
  return light > 0.86 ? ramp[0] : light > 0.55 ? ramp[1] : light > 0.15 ? ramp[2] : ramp[3];
}

function sphere(grid: Grid, cx: number, cy: number, r: number, ramp = "wlbd", keep?: (px: number, py: number) => boolean) {
  each((x, y, px, py) => {
    const dx = (px - cx) / r, dy = (py - cy) / r, d2 = dx * dx + dy * dy;
    if (d2 > 1 || (keep && !keep(px, py))) return;
    put(grid, x, y, shade(dx, dy, Math.sqrt(1 - d2), ramp));
  });
}

function disk(grid: Grid, cx: number, cy: number, r: number, letter: string) {
  each((x, y, px, py) => { if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) put(grid, x, y, letter); });
}

/** An elliptical ring; `half` keeps only the front (+1) or back (-1) half. */
function ring(grid: Grid, cx: number, cy: number, a: number, b: number, width: number, letter: string, half = 0, angle = 0) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  each((x, y, px, py) => {
    const dx = px - cx, dy = py - cy;
    const u = dx * cos + dy * sin, v = -dx * sin + dy * cos;
    const e = Math.sqrt((u / a) ** 2 + (v / b) ** 2);
    if (Math.abs(e - 1) * Math.min(a, b) > width / 2) return;
    if (half && Math.sign(v || 1) !== half) return;
    put(grid, x, y, letter);
  });
}

function line(grid: Grid, x0: number, y0: number, x1: number, y1: number, letter: string) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    put(grid, Math.floor(x0 + (x1 - x0) * t), Math.floor(y0 + (y1 - y0) * t), letter);
  }
}

function plus(grid: Grid, x: number, y: number, letter: string, center = "w") {
  put(grid, x, y, center); put(grid, x - 1, y, letter); put(grid, x + 1, y, letter); put(grid, x, y - 1, letter); put(grid, x, y + 1, letter);
}

/**
 * One-cell dark outline around the silhouette (4-neighbours), like classic
 * sprites. Only the outside is outlined: gaps enclosed by the shape (between an
 * orbit and its nucleus) stay open instead of filling in.
 */
function outline(grid: Grid): Sprite {
  const out = grid.map((row) => [...row]);
  const outside = new Set<number>();
  const queue: [number, number][] = [];
  for (let i = 0; i < N; i++) for (const [x, y] of [[i, 0], [i, N - 1], [0, i], [N - 1, i]]) if (grid[y][x] === ".") queue.push([x, y]);
  while (queue.length) {
    const [x, y] = queue.pop()!;
    if (!inside(x, y) || grid[y][x] !== "." || outside.has(y * N + x)) continue;
    outside.add(y * N + x);
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (grid[y][x] !== "." || !outside.has(y * N + x)) continue;
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inside(x + dx, y + dy) && !".o".includes(grid[y + dy][x + dx]) && grid[y + dy][x + dx] !== "*");
    if (near) out[y][x] = "o";
  }
  // `*` marks loose sparkles that stay unoutlined.
  return out.map((row) => row.join("").replaceAll("*", "y"));
}

const DRAW: Record<AstroIconId, (f: number) => Sprite> = {
  planeta: (f) => {
    const g = blank();
    sphere(g, 6, 6, 4.6);
    // Two cloud bands that drift a cell between frames.
    each((x, y, px, py) => {
      if (g[y][x] === ".") return;
      const band = py - (px - 6) * 0.25;
      if (Math.abs(band - 6.8) < 0.55 || (Math.abs(band - 4.2) < 0.5 && (x + f) % 4 !== 0)) put(g, x, y, g[y][x] === "w" ? "l" : g[y][x] === "l" ? "b" : "d");
    });
    return outline(g);
  },
  saturno: (f) => {
    const g = blank();
    ring(g, 6, 6, 5.5, 1.5, 0.7, "y", -1, -0.4);
    sphere(g, 6, 6, 3.7);
    ring(g, 6, 6, 5.5, 1.5, 0.7, "y", 1, -0.4);
    put(g, f ? 10 : 1, f ? 1 : 10, "*");
    return outline(g);
  },
  lua: (f) => {
    const g = blank();
    sphere(g, 5.4, 6.2, 4.8, "wlbd", (px, py) => (px - 8) ** 2 + (py - 4) ** 2 > 4.2 * 4.2);
    if (f) { plus(g, 9, 8, "*", "*"); } else put(g, 10, 7, "*");
    return outline(g);
  },
  sol: (f) => {
    const g = blank();
    const reach = f ? 5.6 : 4.9;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      line(g, 6 + Math.cos(a) * 3.6, 6 + Math.sin(a) * 3.6, 6 + Math.cos(a) * (i % 2 ? reach - 0.8 : reach), 6 + Math.sin(a) * (i % 2 ? reach - 0.8 : reach), "y");
    }
    sphere(g, 6, 6, 3.2, "wllb");
    return outline(g);
  },
  orbita: (f) => {
    const g = blank();
    // One tilted orbit, traced a pixel wide: the back half behind the nucleus, the front over it.
    const angle = -0.7, a = 5.4, b = 2.3;
    const at = (t: number) => {
      const u = Math.cos(t) * a, v = Math.sin(t) * b;
      return [Math.floor(6 + u * Math.cos(angle) - v * Math.sin(angle)), Math.floor(6 + u * Math.sin(angle) + v * Math.cos(angle))] as const;
    };
    const trace = (front: boolean, letter: string) => {
      for (let i = 0; i < 72; i++) { const t = (i / 72) * Math.PI * 2; if ((Math.sin(t) > 0) === front) { const [x, y] = at(t); put(g, x, y, letter); } }
    };
    trace(false, "b");
    sphere(g, 6, 6, 2.7);
    trace(true, "l");
    const [ex, ey] = at(f ? 2.4 : -0.9);
    put(g, ex, ey, "y");
    return outline(g);
  },
  galaxia: (f) => {
    const g = blank();
    for (let arm = 0; arm < 2; arm++) {
      for (let i = 0; i < 40; i++) {
        const th = i / 40 * 3.4, r = 1.4 + th * 1.18, a = th + arm * Math.PI + f * 0.5;
        put(g, Math.floor(6 + Math.cos(a) * r), Math.floor(6 + Math.sin(a) * r * 0.9), i < 18 ? "l" : "b");
      }
    }
    disk(g, 6, 6, 1.8, "w");
    return outline(g);
  },
  nebulosa: (f) => {
    const g = blank();
    disk(g, 4.6, 5.2, 3.3, "b");
    disk(g, 7.8, 6.6, 3, "d");
    disk(g, 5.6, 8, 2.4, "b");
    disk(g, 4, 4.4, 1.4, "l");
    disk(g, 7.6, 5.6, 1, "l");
    const stars: [number, number][] = f ? [[3, 6], [8, 8], [6, 3]] : [[5, 6], [9, 5], [3, 8]];
    for (const [x, y] of stars) put(g, x, y, "w");
    return outline(g);
  },
  cometa: (f) => {
    const g = blank();
    each((x, y, px, py) => {
      const u = (px - 3) * 0.7 - (py - 9) * 0.7, v = (px - 3) * 0.7 + (py - 9) * 0.7;
      if (u < 0.5 || u > (f ? 10.5 : 9.5)) return;
      if (Math.abs(v) < 1.7 - u * 0.12) put(g, x, y, u < 3.5 ? "l" : u < 6.5 ? "b" : "d");
    });
    sphere(g, 3.4, 8.6, 2.6, "wwlb");
    return outline(g);
  },
  buraco: (f) => {
    const g = blank();
    ring(g, 6, 6, 5.5, 1.6, 1.1, "l", -1, -0.3);
    disk(g, 6, 6, 3.9, "y");
    disk(g, 6, 6, 3.1, "k");
    ring(g, 6, 6, 5.5, 1.6, 1.1, "l", 1, -0.3);
    put(g, f ? 10 : 2, f ? 5 : 7, "w");
    return outline(g);
  },
  estrela: (f) => {
    const g = blank();
    // Rest: arms reach 4 cells; pulse: 5 cells plus diagonal glints.
    const r = f ? 6 : 5;
    each((x, y, px, py) => {
      const dx = Math.abs(px - 6), dy = Math.abs(py - 6);
      const arm = (dx < 1.3 - dy * 0.2 && dy < r) || (dy < 1.3 - dx * 0.2 && dx < r) || dx + dy < 2.6;
      if (arm) put(g, x, y, dx + dy < 1.4 ? "w" : dx + dy < 2.8 ? "y" : px < 6 || py < 6 ? "l" : "b");
    });
    if (f) for (const [x, y] of [[3, 3], [8, 3], [3, 8], [8, 8]]) put(g, x, y, "*");
    return outline(g);
  },
  pulsar: (f) => {
    const g = blank();
    const a = f ? Math.PI / 4 : Math.PI / 2;
    for (const s of [1, -1]) {
      for (let r = 2.4; r < 6; r += 0.4) {
        const w = 0.3 + (r - 2.4) * 0.3;
        for (let k = -w; k <= w; k += 0.5) put(g, Math.floor(6 + Math.cos(a) * r * s - Math.sin(a) * k), Math.floor(6 + Math.sin(a) * r * s + Math.cos(a) * k), r < 3.6 ? "y" : "l");
      }
    }
    sphere(g, 6, 6, 2.6, "wwlb");
    return outline(g);
  },
  constelacao: (f) => {
    const g = blank();
    const stars: [number, number][] = [[2, 8], [4, 4], [6, 6], [8, 2], [10, 5], [9, 9]];
    for (let i = 0; i < stars.length - 1; i++) line(g, stars[i][0] + 0.5, stars[i][1] + 0.5, stars[i + 1][0] + 0.5, stars[i + 1][1] + 0.5, "d");
    stars.forEach(([x, y], i) => { if ((i + f) % 2 === 0) plus(g, x, y, i % 3 ? "y" : "l"); else put(g, x, y, "w"); });
    return outline(g);
  },
  satelite: (f) => {
    const g = blank();
    sphere(g, 3.8, 8.2, 3.2);
    const sx = f ? 8 : 7, sy = f ? 2 : 3;
    for (const dx of [-2, -1, 3, 4]) put(g, sx + dx - 1, sy, "b");
    put(g, sx, sy, "s"); put(g, sx + 1, sy, "s"); put(g, sx, sy + 1, "g"); put(g, sx + 1, sy + 1, "s");
    put(g, sx + 1, sy - 1, f ? "y" : "s");
    return outline(g);
  },
  foguete: (f) => {
    const rows = [
      ".....l......",
      "....wlb.....",
      "....wlb.....",
      "...wllbd....",
      "...lkkbd....",
      "...lkkbd....",
      "...llbbd....",
      "..dllbbdd...",
      ".dd.lbd.dd..",
      ".....y......",
      f ? "....yry....." : ".....r......",
      f ? ".....r......" : "............",
    ];
    // Leaning a little to the right, like it is taking off.
    const g = blank();
    rows.forEach((row, y) => [...row].forEach((letter, x) => { if (letter !== ".") put(g, x + Math.floor((11 - y) / 4), y, letter); }));
    return outline(g);
  },
  asteroide: (f) => {
    const g = blank();
    const bumps = [4.6, 3.8, 4.8, 3.6, 4.4, 4.9, 3.9, 4.2];
    sphere(g, 6, 6.2, 5, "lbdd", (px, py) => {
      const a = Math.atan2(py - 6.2, px - 6), i = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 8) % 8;
      return Math.hypot(px - 6, py - 6.2) < bumps[i];
    });
    for (const [x, y] of [[4, 5], [7, 7], [6, 3]] as const) if (g[y][x] !== ".") put(g, x, y, "d");
    put(g, f ? 10 : 11, f ? 1 : 2, "*");
    return outline(g);
  },
  eclipse: (f) => {
    const g = blank();
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6 + (f ? Math.PI / 12 : 0);
      line(g, 6 + Math.cos(a) * 3.8, 6 + Math.sin(a) * 3.8, 6 + Math.cos(a) * (i % 2 ? 4.9 : 5.6), 6 + Math.sin(a) * (i % 2 ? 4.9 : 5.6), i % 2 ? "l" : "y");
    }
    disk(g, 6, 6, 3.9, "w");
    disk(g, 6, 6, 3.1, "k");
    put(g, 8, 4, "w");
    return outline(g);
  },
};

const cache = new Map<string, Sprite>();
/** The sprite for one icon and frame (0 rest, 1 alternate). */
export function astroSprite(icon: AstroIconId, frame: number): Sprite {
  const key = `${icon}:${frame}`;
  let sprite = cache.get(key);
  if (!sprite) { sprite = DRAW[icon](frame); cache.set(key, sprite); }
  return sprite;
}

/** Hue-shifted ramp from the Astro colour: cooler shadows, warmer lights. */
export function spritePalette(color: string): Record<string, string> {
  const n = parseInt(color.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  const d = max - min, s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const h = d ? (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 : 230;
  const hsl = (hue: number, sat: number, light: number) => `hsl(${((hue % 360) + 360) % 360} ${Math.round(Math.min(1, sat) * 100)}% ${Math.round(Math.max(0, Math.min(1, light)) * 100)}%)`;
  const toward = (target: number, amount: number) => { const delta = ((target - h + 540) % 360) - 180; return h + Math.sign(delta) * Math.min(Math.abs(delta), amount); };
  return {
    o: hsl(toward(250, 30), 0.35, 0.09),
    d: hsl(toward(250, 18), s * 0.55, l * 0.5),
    b: hsl(h, s, l),
    l: hsl(toward(55, 14), s * 0.95, l + (1 - l) * 0.38),
    w: hsl(toward(55, 22), s * 0.6, 0.93),
    y: "#ffd36b",
    r: "#f2843a",
    k: "#08080d",
    s: "#c9ced8",
    g: "#6b7180",
  };
}
