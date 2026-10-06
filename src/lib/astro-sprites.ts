import type { AstroIconId } from "@/client/types";

/**
 * Pixel-style Astro icons (ADR-069): hand-drawn 12×12 kawaii mascots, one per
 * cosmic icon, after MonoCode's pixel mascots and the pixel-art-sprites skill:
 * a readable silhouette at 1×, few colours, hard edges, two frames.
 *
 * Letters: `#` body (a pastel of the Astro's colour), `h` body highlight,
 * `s` body shade, `E` eye, `V` light eye (on dark bodies), `p` cheek,
 * `m` mouth, `g` gold, `G` deep gold, `F` flame, `k` void, `w` white,
 * `.` empty. `talk` replaces rows while the Astro works (mouths open, flames
 * flicker); eyes blink on their own.
 */
export const SPRITE_SIZE = 12;
export type Sprite = readonly string[];
type Mascot = { rest: Sprite; talk: Record<number, string> };

const MASCOTS: Record<AstroIconId, Mascot> = {
  planeta: {
    rest: [
      "....####....",
      "..########..",
      ".hhhhhhhhhh.",
      ".##########.",
      "############",
      "###E####E###",
      "##p######p##",
      "#####mm#####",
      ".##########.",
      ".ssssssssss.",
      "..########..",
      "....####....",
    ],
    talk: { 8: ".####mm####." },
  },
  saturno: {
    rest: [
      "............",
      "....####....",
      "...######...",
      "..########..",
      "..#E####E#..",
      "g.#p#mm#p#.g",
      "gg########gg",
      ".gGGGGGGGGg.",
      "..gg####gg..",
      "....####....",
      "............",
      "............",
    ],
    talk: { 6: "gg###mm###gg", 0: "..........w." },
  },
  lua: {
    rest: [
      "...#####....",
      ".#######....",
      "####........",
      "###.........",
      "###E.....g..",
      "###.....ggg.",
      "###p.....g..",
      "###m........",
      "####........",
      ".######.....",
      "..#######...",
      "....####....",
    ],
    talk: { 4: "###E........", 5: "###.........", 6: "###p......g.", 7: "###mm....ggg", 8: "####......g." },
  },
  sol: {
    rest: [
      ".....gg.....",
      ".g...gg...g.",
      "..g.####.g..",
      "...######...",
      "..########..",
      "gg#E####E#gg",
      "gg#p#mm#p#gg",
      "..########..",
      "...######...",
      "..g.####.g..",
      ".g...gg...g.",
      ".....gg.....",
    ],
    talk: { 0: "............", 1: "..g..gg..g..", 10: "..g..gg..g..", 11: "............", 5: ".g#E####E#g.", 6: ".g#p#mm#p#g.", 7: "..###mm###.." },
  },
  orbita: {
    rest: [
      "...w........",
      "..g.g.......",
      ".g...####...",
      ".g..######..",
      "g..########.",
      "g..#E####E#.",
      "g..#p#mm#p#.",
      ".g.########.",
      ".g..######..",
      "..g..####.g.",
      "...g.....g..",
      "....ggggg...",
    ],
    talk: { 0: "............", 1: "..ggg.......", 11: "....ggwgg...", 7: ".g.###mm###." },
  },
  galaxia: {
    rest: [
      "............",
      "...hhhh.....",
      ".hh....hh...",
      "h...####.h..",
      "h..######.h.",
      ".h.#E##E#..h",
      "..h#p##p#..h",
      "...##mm##.h.",
      ".h..####.hh.",
      "..hh....h...",
      ".....hhh....",
      "............",
    ],
    talk: { 1: ".....hhhh...", 2: "...hh....hh.", 3: "..h.####...h", 8: "hh..####..h.", 9: "...h....hh..", 10: "....hhh.....", 7: "...#mmmm#.h." },
  },
  nebulosa: {
    rest: [
      "............",
      "............",
      "...###......",
      "..#####.###.",
      ".hhhhhhhhhhh",
      "############",
      "###E####E###",
      "##p##mm##p##",
      "############",
      ".##########.",
      "..###..###..",
      "............",
    ],
    talk: { 0: ".w.......w..", 1: "......w.....", 7: "##p#mmmm#p##" },
  },
  cometa: {
    rest: [
      "..........gg",
      ".........gg.",
      "........hg..",
      ".......hhg..",
      "..####hh....",
      ".######.....",
      "########....",
      "#E####E#....",
      "#p#mm#p#....",
      "########....",
      ".######.....",
      "..####......",
    ],
    talk: { 0: ".........g.g", 1: "........ggg.", 2: ".......hhg..", 3: "......hhg...", 9: "###mm###...." },
  },
  buraco: {
    rest: [
      "............",
      "....kkkk....",
      "..kkkkkkkk..",
      ".kkkkkkkkkk.",
      ".kkVkkkkVkk.",
      "gkkkkkkkkkkg",
      "ggkkkwwkkkgg",
      ".ggGGGGGGgg.",
      "..gkkkkkkg..",
      "...kkkkkk...",
      "....kkkk....",
      "............",
    ],
    talk: { 5: "gkkkkwwkkkkg", 0: "...........w", 11: "w..........." },
  },
  estrela: {
    rest: [
      ".....##.....",
      ".....##.....",
      "....####....",
      "....hhhh....",
      "############",
      ".##E####E##.",
      "..#p#mm#p#..",
      "...######...",
      "...##..##...",
      "..##....##..",
      ".##......##.",
      "............",
    ],
    talk: { 7: "...##mm##...", 0: "w....##....w", 11: "w..........w" },
  },
  pulsar: {
    rest: [
      ".....hh.....",
      ".....hh.....",
      "....####....",
      "...######...",
      "..########..",
      "..#E####E#..",
      "..#p#mm#p#..",
      "..########..",
      "...######...",
      "....####....",
      ".....hh.....",
      ".....hh.....",
    ],
    talk: { 0: "hh........hh", 1: ".hh......hh.", 10: ".hh......hh.", 11: "hh........hh", 7: "..###mm###.." },
  },
  constelacao: {
    rest: [
      "............",
      ".g......g...",
      "ggg....ggg..",
      ".g.h....g...",
      "....h..h....",
      ".....#h.....",
      "....###.....",
      ".#########..",
      "..#E###E#...",
      "...#pmp#....",
      "...##.##....",
      "..##...##...",
    ],
    talk: { 1: "wgw.....g...", 2: "ggg...wgggw.", 9: "...#mmm#...." },
  },
  satelite: {
    rest: [
      "............",
      "......g.....",
      ".....g......",
      "....g.......",
      "...######...",
      "hh.#E##E#.hh",
      "hhh##mm##hhh",
      "hh.#p##p#.hh",
      "...######...",
      "............",
      "............",
      "............",
    ],
    talk: { 1: "......w.....", 6: "hhh#mmmm#hhh", 0: ".......w...." },
  },
  foguete: {
    rest: [
      ".....##.....",
      "....####....",
      "....hhhh....",
      "...######...",
      "...#E##E#...",
      "...##mm##...",
      "...######...",
      "..g######g..",
      ".gg######gg.",
      ".g..####..g.",
      ".....FF.....",
      ".....F......",
    ],
    talk: { 10: "....FggF....", 11: ".....FF.....", 5: "...#mmmm#..." },
  },
  asteroide: {
    rest: [
      "............",
      "...#####....",
      "..########..",
      ".####s#####.",
      "##########s.",
      "###E####E###",
      "##p##mm##p##",
      ".##########.",
      ".#s#######..",
      "..########..",
      "...###.##...",
      "............",
    ],
    talk: { 0: "..........w.", 6: "##p#mmmm#p##" },
  },
  eclipse: {
    rest: [
      "............",
      ".g...gg...g.",
      "..gggggggg..",
      ".ggkkkkkkgg.",
      ".gkkkkkkkkg.",
      "ggkVkkkkVkgg",
      "ggkkkwwkkkgg",
      ".gkkkkkkkkg.",
      ".ggkkkkkkgg.",
      "..gggggggg..",
      ".g...gg...g.",
      "............",
    ],
    talk: { 1: "g....gg....g", 10: "g....gg....g", 6: "ggkkwwwwkkgg" },
  },
};

/** The sprite for one icon: frame 0 rests, frame 1 talks (while the Astro works). */
export function astroSprite(icon: AstroIconId, frame: number): Sprite {
  const mascot = MASCOTS[icon];
  if (!frame) return mascot.rest;
  return mascot.rest.map((row, y) => mascot.talk[y] ?? row);
}

type Hsl = readonly [number, number, number];
function toHsl(color: string): Hsl {
  const n = parseInt(color.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const h = d ? ((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360 : 230;
  return [h, s, l];
}
const css = ([h, s, l]: Hsl) => `hsl(${Math.round(h)} ${Math.round(Math.min(1, s) * 100)}% ${Math.round(Math.max(0, Math.min(1, l)) * 100)}%)`;


/** The pastel body colour of an Astro's mascot. */
export function spriteBody(color: string): Hsl {
  const [h, s] = toHsl(color);
  return [h, s < 0.08 ? 0.06 : Math.min(0.62, Math.max(0.38, s * 0.7)), 0.74];
}

/** The mascot's colours: shade leans cool, highlight leans warm. */
export function spritePalette(color: string): Record<string, string> {
  const body = spriteBody(color);
  const [h, sat] = body;
  const shift = (target: number, amount: number) => { const delta = ((target - h + 540) % 360) - 180; return h + Math.sign(delta) * Math.min(Math.abs(delta), amount); };
  return {
    "#": css(body),
    h: css([shift(55, 10), sat * 0.9, 0.87]),
    s: css([shift(250, 14), sat * 0.9, 0.6]),
    edge: css([shift(250, 18), sat * 0.8, 0.4]),
    g: "#ffd36b",
    G: "#e4a53c",
    F: "#f2843a",
    k: "#16151e",
    w: "#ffffff",
    E: "#1c1a26",
    V: "#f4f1ff",
    p: "#ff8fa6",
    m: "#3a2230",
  };
}

/** The body pastel, a touch lighter toward the top-left like MonoCode's mascots. */
export function bodyTone(body: Hsl, x: number, y: number) {
  return css([body[0], body[1], body[2] + 0.05 - y * 0.012 - x * 0.006]);
}
