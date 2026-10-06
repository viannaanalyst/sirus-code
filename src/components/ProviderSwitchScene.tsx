import { useEffect, useRef, useState } from "react";
import type { AgentProviderId } from "@/client/types";
import { ambientActive } from "@/lib/ambient-motion";
import { PROVIDER_MARKS } from "@/lib/providers";
import { createProviderScene, SCENE_LIFETIME } from "@/lib/provider-scenes";
import { subscribeProviderSwitch } from "@/lib/provider-switch";
import { useMotionPreferences } from "@/lib/use-motion-preferences";

/**
 * Behind the conversation of the active pane, a provider switch made in this
 * pane's model picker plays a 5 s scene: the new provider's logo builds itself
 * from blocks, then everything fades. The canvas exists only while it plays.
 */
export function ProviderSwitchScene({ owner }: { owner: string }) {
  const reduced = useMotionPreferences();
  const [play, setPlay] = useState<{ owner: string; to: AgentProviderId; at: number } | null>(null);
  useEffect(() => subscribeProviderSwitch((change) => {
    if (change.owner !== owner || reduced || !ambientActive()) return;
    setPlay({ owner, to: change.to, at: change.at });
  }), [owner, reduced]);
  // A different conversation in this pane ends the scene.
  if (!play || play.owner !== owner) return null;
  return <SceneCanvas key={play.at} to={play.to} startedAt={play.at} onDone={() => setPlay(null)} />;
}

function SceneCanvas({ to, startedAt, onDone }: { to: AgentProviderId; startedAt: number; onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });
  useEffect(() => {
    const node = canvas.current;
    const ctx = node?.getContext("2d");
    if (!node || !ctx) return;
    const mark = new Image();
    mark.src = PROVIDER_MARKS[to].src;
    const scene = createProviderScene(to, mark, Boolean(PROVIDER_MARKS[to].monochrome));
    let frame = 0, width = 0, height = 0, dpr = 1;
    const resize = () => {
      const rect = node.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = rect.width; height = rect.height;
      node.width = Math.round(width * dpr); node.height = Math.round(height * dpr);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    const tick = (now: number) => {
      const age = now - startedAt;
      // Leaving the window or covering it with Settings ends the scene early.
      if (age >= SCENE_LIFETIME || !ambientActive()) { done.current(); return; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      scene.draw({ ctx, width, height, dpr, light: document.documentElement.dataset.theme === "light" }, age, now);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [to, startedAt]);
  return <canvas ref={canvas} aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 size-full" />;
}
