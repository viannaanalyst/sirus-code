import { drawLandingOrbits } from "../../src/lib/landing-orbits";

export type Effect = "mare" | "veu" | "orbitas";
type Point = [number, number];
const tau = Math.PI * 2;
const silver = (alpha: number) => `rgba(226,231,239,${Math.max(0, Math.min(1, alpha))})`;

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, alpha: number) {
  const light = ctx.createRadialGradient(x, y, 0, x, y, radius);
  light.addColorStop(0, silver(alpha));
  light.addColorStop(.12, silver(alpha * .45));
  light.addColorStop(.45, silver(alpha * .08));
  light.addColorStop(1, silver(0));
  ctx.fillStyle = light;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function path(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
}

function waveY(x: number, lane: number, time: number) {
  return .32 + .48 * x + lane * .008
    + .038 * Math.sin(x * 11 - time * .25 + lane * .015)
    + .028 * Math.sin(x * 4.5 + time * .19)
    - .055 * Math.exp(-(((x - .25 - .025 * Math.sin(time * .18)) / .15) ** 2));
}

function tide(ctx: CanvasRenderingContext2D, w: number, h: number, time: number) {
  // A diagonal topographic landscape; its crest stays below the import banner.
  for (let lane = 0; lane < 76; lane++) {
    const dense = lane > 37;
    const points: Point[] = [];
    for (let step = 0; step <= 140; step++) {
      const x = step / 140;
      points.push([x * w, waveY(x, lane, time) * h]);
    }
    const light = ctx.createLinearGradient(0, 0, w, h * .6);
    light.addColorStop(0, silver(dense ? .055 : .22));
    light.addColorStop(.32, silver(dense ? .09 : .34));
    light.addColorStop(.7, silver(dense ? .04 : .15));
    light.addColorStop(1, silver(.02));
    ctx.strokeStyle = light;
    ctx.lineWidth = lane % 6 === 0 ? 1 : .65;
    path(ctx, points); ctx.stroke();

    if (lane < 40 && lane % 3 === 0) {
      const progress = ((time * .025 + lane * .061) % 1.3) - .15;
      const highlight = ctx.createLinearGradient((progress - .1) * w, 0, (progress + .1) * w, 0);
      highlight.addColorStop(0, silver(0));
      highlight.addColorStop(.5, silver(lane % 9 === 0 ? .85 : .4));
      highlight.addColorStop(1, silver(0));
      ctx.strokeStyle = highlight; ctx.lineWidth = 1.05;
      path(ctx, points); ctx.stroke();
      if (progress > 0 && progress < 1 && lane % 9 === 0) {
        glow(ctx, progress * w, waveY(progress, lane, time) * h, 18, .65);
      }
    }
    // Pinpoints follow the wave, with fewer dots than the static background grid.
    if (lane % 2 === 0) {
      const count = Math.min(100, Math.ceil(w / 15));
      for (let dot = 0; dot < count; dot++) {
        const x = (dot + .3 * Math.sin(lane)) / count;
        const glint = .5 + .5 * Math.sin(dot * .47 + lane * .29 - time * .6);
        ctx.fillStyle = silver((dense ? .08 : .13) + glint ** 10 * .28);
        ctx.beginPath(); ctx.arc(x * w, waveY(x, lane, time) * h, dense ? .5 : .75, 0, tau); ctx.fill();
      }
    }
  }
}

function veil(ctx: CanvasRenderingContext2D, w: number, h: number, time: number) {
  // Broad translucent sheets, with fine folds instead of topographic wires.
  const sweep = (x: number, sheet: number, fold: number) =>
    .99 - .78 * x + sheet * .07 + fold * .0018
    + .09 * Math.sin(x * 4.3 + sheet * .45 + time * .13)
    + .032 * Math.sin(x * 9 - time * .2 + sheet * .6);
  for (let sheet = 0; sheet < 5; sheet++) {
    const luminance = ctx.createLinearGradient(0, h, w, 0);
    luminance.addColorStop(0, silver(.01));
    luminance.addColorStop(.2, silver(.095));
    luminance.addColorStop(.46, silver(.016));
    luminance.addColorStop(.76, silver(.085));
    luminance.addColorStop(1, silver(.005));
    const points: Point[] = [];
    for (let step = 0; step <= 120; step++) {
      const x = step / 120;
      points.push([x * w, sweep(x, sheet, 0) * h]);
    }
    // Nested low-opacity strokes feather each sheet without a full-page blur.
    ctx.save(); ctx.globalAlpha *= .12; ctx.strokeStyle = luminance;
    for (let feather = 0; feather < 10; feather++) {
      ctx.lineWidth = h * (.095 - feather * .0085);
      path(ctx, points); ctx.stroke();
    }
    ctx.restore();
    for (let fold = -12; fold <= 12; fold++) {
      const folds: Point[] = [];
      for (let step = 0; step <= 120; step++) {
        const x = step / 120;
        folds.push([x * w, sweep(x, sheet, fold) * h]);
      }
      const edge = ctx.createLinearGradient(0, h, w, 0);
      const strength = Math.exp(-Math.abs(fold) / 5) * .35;
      edge.addColorStop(0, silver(.02));
      edge.addColorStop(.21, silver(strength));
      edge.addColorStop(.5, silver(strength * .06));
      edge.addColorStop(.78, silver(strength * .65));
      edge.addColorStop(1, silver(.01));
      ctx.strokeStyle = edge; ctx.lineWidth = .65;
      path(ctx, folds); ctx.stroke();
    }
    const x = .13 + .025 * Math.sin(time * .12 + sheet);
    glow(ctx, x * w, sweep(x, sheet, 0) * h, h * .11, .09);
    glow(ctx, w * .88, sweep(.88, sheet, 0) * h, h * .12, .055);
  }
}

export function drawEffect(ctx: CanvasRenderingContext2D, effect: Effect, width: number, height: number, time: number, intensity: number) {
  ctx.clearRect(0, 0, width, height);
  ctx.save(); ctx.globalAlpha = intensity;
  if (effect === "orbitas") drawLandingOrbits(ctx, width, height, time);
  else ({ mare: tide, veu: veil }[effect])(ctx, width, height, time);
  ctx.restore();
}
