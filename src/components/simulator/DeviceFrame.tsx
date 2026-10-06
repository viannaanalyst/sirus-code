// Device chassis for the iOS Simulator pane (ADR-066). Adapted from Synara's
// DeviceFrame (MIT, Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro).
//
// Drawn rather than composited from Apple's bezel artwork (marketing-only
// license, and its side buttons may not become controls): concentric squircle
// bands sized from the device's own pixel dimensions, so one drawing fits an
// iPhone or a 13" iPad.
import { memo, useId, useMemo, type CSSProperties, type ReactNode } from "react";

export type DeviceKind = "iPhone" | "iPad";
export type HardwareButton = "lock" | "volume-up" | "volume-down";

type Nub = { side: "left" | "right" | "top"; at: number; len: number; name: string };
type DeviceSpec = { pixelW: number; pixelH: number; screenRadius: number; frame: number; silver: number; grey: number; nubProtrude: number; nubs: Nub[] };

const SPECS: Record<DeviceKind, DeviceSpec> = {
  iPhone: {
    pixelW: 1206, pixelH: 2622, screenRadius: 186, frame: 34, silver: 8, grey: 12, nubProtrude: 27,
    nubs: [
      { side: "left", at: 507, len: 102, name: "action" },
      { side: "left", at: 690, len: 192, name: "volumeUp" },
      { side: "left", at: 927, len: 192, name: "volumeDown" },
      { side: "right", at: 813, len: 303, name: "power" },
    ],
  },
  iPad: {
    pixelW: 1668, pixelH: 2420, screenRadius: 58, frame: 64, silver: 12, grey: 16, nubProtrude: 20,
    nubs: [
      { side: "right", at: 202, len: 104, name: "volumeUp" },
      { side: "right", at: 328, len: 104, name: "volumeDown" },
      { side: "top", at: -148, len: 126, name: "power" },
    ],
  },
};

const NUB_ACTIONS: Record<string, { label: string; button?: HardwareButton }> = {
  volumeUp: { label: "simulator.volumeUp", button: "volume-up" },
  volumeDown: { label: "simulator.volumeDown", button: "volume-down" },
  power: { label: "simulator.lock", button: "lock" },
};

function metrics(kind: DeviceKind, pixelW?: number, pixelH?: number) {
  const spec = SPECS[kind];
  const edge = spec.frame + spec.silver + spec.grey;
  const margin = edge + spec.nubProtrude;
  return { spec, edge, margin, W: (pixelW ?? spec.pixelW) + 2 * margin, H: (pixelH ?? spec.pixelH) + 2 * margin };
}

/** Continuous ("squircle") rounded rectangle: three cubic Béziers per corner. */
function squircle(x: number, y: number, w: number, h: number, radius: number): string {
  const r = Math.min(radius, Math.min(w, h) / 3.06);
  const [c1, c2, c3, c4, c5, c6, c7] = [1.528665, 1.088311, 0.868407, 0.631494, 0.372375, 0.16906, 0.066987].map((k) => k * r);
  const right = x + w, bottom = y + h;
  const n = (v: number) => +v.toFixed(3);
  const C = (a: number, b: number, c: number, d: number, e: number, f: number) => `C${n(a)} ${n(b)} ${n(c)} ${n(d)} ${n(e)} ${n(f)}`;
  return [
    `M${n(x + c1)} ${n(y)}`, `L${n(right - c1)} ${n(y)}`,
    C(right - c2, y, right - c3, y, right - c4, y + c7), C(right - c5, y + c6, right - c6, y + c5, right - c7, y + c4), C(right, y + c3, right, y + c2, right, y + c1),
    `L${n(right)} ${n(bottom - c1)}`,
    C(right, bottom - c2, right, bottom - c3, right - c7, bottom - c4), C(right - c6, bottom - c5, right - c5, bottom - c6, right - c4, bottom - c7), C(right - c3, bottom, right - c2, bottom, right - c1, bottom),
    `L${n(x + c1)} ${n(bottom)}`,
    C(x + c2, bottom, x + c3, bottom, x + c4, bottom - c7), C(x + c5, bottom - c6, x + c6, bottom - c5, x + c7, bottom - c4), C(x, bottom - c3, x, bottom - c2, x, bottom - c1),
    `L${n(x)} ${n(y + c1)}`,
    C(x, y + c2, x, y + c3, x + c7, y + c4), C(x + c6, y + c5, x + c5, y + c6, x + c4, y + c7), C(x + c3, y, x + c2, y, x + c1, y), "Z",
  ].join("");
}

function paths(kind: DeviceKind, pixelW?: number, pixelH?: number) {
  const { spec, edge, W, H } = metrics(kind, pixelW, pixelH);
  const band = (inset: number) => squircle(spec.nubProtrude + inset, spec.nubProtrude + inset, W - 2 * (spec.nubProtrude + inset), H - 2 * (spec.nubProtrude + inset), spec.screenRadius + (edge - inset));
  const p = spec.nubProtrude;
  const nub = ({ side, at, len }: Nub) => {
    const capTop = at + 6, capBottom = at + len - 6;
    if (side === "left") return { fill: `M0 ${at}h${p}v${len}H0z`, edge: `M${p} ${at}H6Q0 ${at} 0 ${capTop}V${capBottom}Q0 ${at + len} 6 ${at + len}H${p}` };
    if (side === "right") return { fill: `M${W - p} ${at}H${W}v${len}H${W - p}z`, edge: `M${W - p} ${at}H${W - 6}Q${W} ${at} ${W} ${capTop}V${capBottom}Q${W} ${at + len} ${W - 6} ${at + len}H${W - p}` };
    const x = at >= 0 ? at : W + at - len;
    return { fill: `M${x} 0v${p}h${len}V0z`, edge: `M${x} ${p}V6Q${x} 0 ${x + 6} 0H${x + len - 6}Q${x + len} 0 ${x + len} 6V${p}` };
  };
  const nubs = spec.nubs.map(nub);
  return { W, H, outer: band(0), grey: band(spec.silver), black: band(spec.silver + spec.grey), cutout: band(edge), nubFill: nubs.map((s) => s.fill).join(""), nubEdge: nubs.map((s) => s.edge).join("") };
}

/** The phone or tablet around `children` (the live screen), with clickable side buttons. */
export const DeviceScreen = memo(function DeviceScreen({ children, kind = "iPhone", pixelWidth, pixelHeight, landscape = false, onPressButton, label }: {
  children: ReactNode;
  kind?: DeviceKind;
  pixelWidth?: number;
  pixelHeight?: number;
  landscape?: boolean;
  onPressButton?: (button: HardwareButton) => void;
  label: (key: string) => string;
}) {
  const gradient = useId();
  const drawn = useMemo(() => paths(kind, pixelWidth, pixelHeight), [kind, pixelWidth, pixelHeight]);
  const geo = useMemo(() => {
    const { spec, margin, W, H } = metrics(kind, pixelWidth, pixelHeight);
    const w = pixelWidth ?? spec.pixelW, h = pixelHeight ?? spec.pixelH;
    return {
      aspect: W / H,
      screen: { left: `${(100 * margin) / W}%`, top: `${(100 * margin) / H}%`, width: `${100 - (200 * margin) / W}%`, height: `${100 - (200 * margin) / H}%`, borderRadius: `${(100 * spec.screenRadius) / w}% / ${(100 * spec.screenRadius) / h}%` } satisfies CSSProperties,
      nubs: spec.nubs.map(({ side, at, len, name }) => ({
        name,
        side,
        style: (side === "top"
          ? { top: 0, height: `${(100 * margin) / H}%`, left: `${(100 * (at >= 0 ? at : W + at - len)) / W}%`, width: `${(100 * len) / W}%` }
          : { [side]: 0, width: `${(100 * margin) / W}%`, top: `${(100 * at) / H}%`, height: `${(100 * len) / H}%` }) as CSSProperties,
      })),
    };
  }, [kind, pixelWidth, pixelHeight]);
  return <div className="simulator-stage">
    <div className="simulator-device" style={{ height: landscape ? `min(100cqw, calc(100cqh / ${geo.aspect}))` : `min(100cqh, calc(100cqw / ${geo.aspect}))`, aspectRatio: geo.aspect, transform: landscape ? "rotate(90deg)" : undefined }}>
      <svg viewBox={`0 0 ${drawn.W} ${drawn.H}`} className="simulator-layer simulator-shadow" aria-hidden><path d={`${drawn.outer} ${drawn.nubFill}`} fill="#000" /></svg>
      <div className="simulator-screen" style={geo.screen}>{children}</div>
      <svg viewBox={`0 0 ${drawn.W} ${drawn.H}`} className="simulator-layer" aria-hidden>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#e8e8ec" /><stop offset="45%" stopColor="#bcbcc0" /><stop offset="55%" stopColor="#b4b4b8" /><stop offset="100%" stopColor="#e2e2e6" /></linearGradient></defs>
        <path d={`${drawn.outer} ${drawn.cutout}`} fill={`url(#${gradient})`} fillRule="evenodd" />
        <path d={`${drawn.grey} ${drawn.cutout}`} fill="#4a4a4e" fillRule="evenodd" />
        <path d={`${drawn.black} ${drawn.cutout}`} fill="#000" fillRule="evenodd" />
        <path d={drawn.cutout} fill="none" stroke="#2a2a2c" strokeWidth={3} />
        <path d={drawn.outer} fill="none" stroke="#000" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <path d={drawn.nubFill} fill="#4a4a4e" />
        <path d={drawn.nubEdge} fill="none" stroke="#000" strokeWidth={1.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {geo.nubs.map(({ name, side, style }) => {
        const action = NUB_ACTIONS[name];
        if (!action?.button || !onPressButton) return null;
        const button = action.button;
        return <button key={name} type="button" aria-label={label(action.label)} title={label(action.label)} className="simulator-nub" data-side={side} style={style} onClick={() => onPressButton(button)} />;
      })}
    </div>
  </div>;
});
