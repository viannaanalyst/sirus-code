import { useLayoutEffect, useRef } from "react";
import type { AgentProviderId } from "@/client/types";
import { ProviderIcon } from "@/components/settings/ProviderIcon";

const TINTS: Record<AgentProviderId, string> = {
  claude: "rgb(217 119 87 / .75)", codex: "rgb(116 170 156 / .75)", opencode: "rgb(214 214 222 / .6)",
  grok: "rgb(226 228 255 / .6)", cursor: "rgb(169 184 214 / .7)", antigravity: "rgb(127 168 255 / .75)",
  droid: "rgb(242 165 65 / .75)", pi: "rgb(240 144 130 / .75)", devin: "rgb(95 179 249 / .75)", hermes: "rgb(214 196 150 / .75)",
};

/**
 * The picker icon swap after a provider switch: the old mark leaves along an
 * orbit, the new one enters from the opposite side and a ring flashes in the
 * new provider's tint. Rendered over the trigger icon only while it plays.
 */
export function ProviderOrbitSwap({ from, to, size, onDone }: { from: AgentProviderId; to: AgentProviderId; size: number; onDone: () => void }) {
  const leaving = useRef<HTMLSpanElement>(null);
  const arriving = useRef<HTMLSpanElement>(null);
  const ring = useRef<HTMLSpanElement>(null);
  const done = useRef(onDone);
  useLayoutEffect(() => { done.current = onDone; });
  useLayoutEffect(() => {
    const radius = size * .95;
    const path = (angle: number, scale: number, opacity: number) => ({ transform: `rotate(${angle}deg) translateX(${radius}px) rotate(${-angle}deg) scale(${scale})`, opacity });
    const animations = [
      ring.current?.animate([{ transform: "scale(.4) rotate(0deg)", opacity: 0 }, { transform: "scale(1) rotate(120deg)", opacity: 1, offset: .5 }, { transform: "scale(1.3) rotate(220deg)", opacity: 0 }], { duration: 760, easing: "ease-out", fill: "forwards" }),
      leaving.current?.animate([{ transform: "none", opacity: 1 }, path(-70, .7, .6), path(-160, .4, 0)], { duration: 460, easing: "cubic-bezier(.5,0,.75,0)", fill: "forwards" }),
      arriving.current?.animate([path(20, .4, 0), path(110, .75, .7), { transform: "none", opacity: 1 }], { duration: 560, delay: 120, easing: "cubic-bezier(.25,1,.5,1)", fill: "forwards" }),
    ];
    const ended = Promise.all(animations.map((animation) => animation?.finished));
    let cancelled = false;
    void ended.then(() => { if (!cancelled) done.current(); }, () => undefined);
    return () => { cancelled = true; animations.forEach((animation) => animation?.cancel()); };
  }, [from, to, size]);
  return <span aria-hidden="true" className="pointer-events-none absolute inset-0">
    <span ref={ring} className="absolute rounded-full border opacity-0" style={{ inset: -size * .95, borderColor: TINTS[to] }} />
    <span ref={leaving} className="absolute inset-0"><ProviderIcon id={from} size={size} /></span>
    <span ref={arriving} className="absolute inset-0 opacity-0"><ProviderIcon id={to} size={size} /></span>
  </span>;
}
