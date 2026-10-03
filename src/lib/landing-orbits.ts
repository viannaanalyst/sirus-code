type Point = [number, number];
const tau = Math.PI * 2;

function orbitPoint(angle: number, radius: number, width: number, height: number, rotation: number): Point {
  const x = Math.cos(angle) * width * radius;
  const y = Math.sin(angle) * height * radius * .54;
  return [width * .52 + x * Math.cos(rotation) - y * Math.sin(rotation), height * .48 + x * Math.sin(rotation) + y * Math.cos(rotation)];
}

function path(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
}

/** The approved preview geometry; time advances at 1× for its Fast option. */
export function drawLandingOrbits(ctx: CanvasRenderingContext2D, width: number, height: number, time: number, ink = "226,231,239") {
  const silver = (alpha: number) => `rgba(${ink},${alpha})`;
  for (let ring = 0; ring < 11; ring++) {
    const radius = .31 + ring * .047;
    const rotation = -.19 + .018 * Math.sin(time * .09 + ring * .25);
    const points: Point[] = [];
    for (let step = 0; step <= 180; step++) points.push(orbitPoint(step / 180 * tau, radius, width, height, rotation));
    const edge = ctx.createLinearGradient(0, 0, width, height);
    edge.addColorStop(0, silver(.02));
    edge.addColorStop(.25, silver(ring % 3 === 0 ? .26 : .1));
    edge.addColorStop(.5, silver(.045));
    edge.addColorStop(.78, silver(ring % 3 === 0 ? .25 : .09));
    edge.addColorStop(1, silver(.01));
    ctx.strokeStyle = edge; ctx.lineWidth = ring % 3 === 0 ? .85 : .55;
    path(ctx, points); ctx.stroke();
    const head = ring * .82 + time * (ring % 2 ? -.045 : .035);
    const tail: Point[] = [];
    for (let step = 0; step <= 28; step++) tail.push(orbitPoint(head - .15 + step / 28 * .15, radius, width, height, rotation));
    const [x, y] = orbitPoint(head, radius, width, height, rotation);
    const [tx, ty] = tail[0];
    const light = ctx.createLinearGradient(tx, ty, x, y);
    light.addColorStop(0, silver(0)); light.addColorStop(1, silver(ring % 3 === 0 ? .8 : .35));
    ctx.strokeStyle = light; ctx.lineWidth = 1.05; path(ctx, tail); ctx.stroke();
    const glowRadius = ring % 3 === 0 ? 16 : 8;
    const strength = ring % 3 === 0 ? .55 : .2;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
    glow.addColorStop(0, silver(strength));
    glow.addColorStop(.12, silver(strength * .45));
    glow.addColorStop(.45, silver(strength * .08));
    glow.addColorStop(1, silver(0));
    ctx.fillStyle = glow;
    ctx.fillRect(x - glowRadius, y - glowRadius, glowRadius * 2, glowRadius * 2);
  }
  for (let star = 0; star < 85; star++) {
    const x = ((star * .61803398875) % 1) * width;
    const y = ((star * .38196601125 + .13) % 1) * height;
    const distance = Math.hypot((x / width - .5) * 1.4, y / height - .44);
    if (distance < .23) continue;
    ctx.fillStyle = silver(.04 + .14 * (.5 + .5 * Math.sin(star + time * .24)) ** 4);
    ctx.beginPath(); ctx.arc(x, y, star % 9 === 0 ? 1 : .6, 0, tau); ctx.fill();
  }
}
