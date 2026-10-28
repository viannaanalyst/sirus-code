import { memo, useLayoutEffect, useMemo, useRef } from "react";
import type { Project, ProjectAppearance } from "@/client/types";
import { avatarScheduler, type AvatarTarget } from "@/lib/avatar-scheduler";
import { cn } from "@/lib/cn";
import { AVATAR_ROWS, AVATAR_SIZE, hashName, lookKey, poseKey, renderAvatar, resolveLook, RESTING_POSE, type AvatarLook, type AvatarPose, type AvatarState } from "@/lib/project-avatar";
import { memoProjectAvatarStates } from "@/lib/project-avatar-state";
import { selectListedSessions, useAppStore } from "@/store/app-store";
import "@/styles/project-avatar.css";

/** One observer for every avatar: the scheduler only works for the ones on screen. */
let observer: IntersectionObserver | null = null;
const observed = new WeakMap<Element, AvatarTarget>();
function observe(canvas: HTMLCanvasElement, target: AvatarTarget): () => void {
  if (typeof IntersectionObserver === "undefined") { avatarScheduler().setVisible(target, true); return () => undefined; }
  observer ??= new IntersectionObserver((changes) => {
    for (const change of changes) { const found = observed.get(change.target); if (found) avatarScheduler().setVisible(found, change.isIntersecting); }
  });
  observed.set(canvas, target);
  observer.observe(canvas);
  return () => { observer?.unobserve(canvas); observed.delete(canvas); };
}

/** The avatar state of one project from the sidebar's own signals; a string, so unrelated updates do not re-render. */
export function useProjectAvatarState(projectId: string | undefined): AvatarState {
  return useAppStore((state) => (projectId ? memoProjectAvatarStates(selectListedSessions(state), state.unseenSessionIds, state.computer?.requests)[projectId] : undefined) ?? "idle");
}

/** Sprite scale for a glyph box: each sprite pixel is a whole number of CSS pixels (12 px, 24 px, 36 px…). */
export const avatarScale = (size: number) => Math.max(1, Math.round(size / AVATAR_SIZE));

interface AvatarProps {
  name: string;
  appearance?: Partial<ProjectAppearance> | null;
  /** Overrides the look (the appearance popover previews options with it). */
  look?: AvatarLook;
  state?: AvatarState;
  /** CSS pixels per sprite pixel. */
  scale?: number;
  /** False draws one still frame and never joins the scheduler. */
  animated?: boolean;
  className?: string;
}

/**
 * A project's pixel avatar: the 12x12 sprite painted on a canvas at an exact integer scale
 * (`image-rendering: pixelated`, in whole device pixels at any DPR). It paints itself only when
 * its look, state or pose changes; the shared scheduler (`avatar-scheduler.ts`) drives the pose.
 */
export const ProjectAvatar = memo(function ProjectAvatar({ name, appearance, look: lookProp, state = "idle", scale = 2, animated = true, className }: AvatarProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const look = useMemo(() => lookProp ?? resolveLook(name, appearance), [lookProp, name, appearance]);
  const seed = useMemo(() => hashName(name), [name]);
  const current = useRef({ look, state, scale });
  useLayoutEffect(() => { current.current = { look, state, scale }; });
  const painted = useRef("");

  const target = useMemo<AvatarTarget>(() => ({
    get state() { return current.current.state; },
    seed,
    paint(pose: AvatarPose) {
      const node = canvas.current;
      if (!node) return;
      const { look: want, scale: cssScale } = current.current;
      const k = Math.max(1, Math.round(cssScale * (window.devicePixelRatio || 1)));
      const key = `${lookKey(want)}|${poseKey(pose)}|${k}`;
      if (key === painted.current) return;
      painted.current = key;
      const width = AVATAR_SIZE * k, height = AVATAR_ROWS * k;
      if (node.width !== width) node.width = width;
      if (node.height !== height) node.height = height;
      node.getContext("2d")?.putImageData(new ImageData(renderAvatar(want, pose, k), width, height), 0, 0);
    },
    center() {
      const rect = canvas.current?.getBoundingClientRect();
      return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
    },
  }), [seed]);

  // Still avatars paint once per change; animated ones join the scheduler for their lifetime.
  useLayoutEffect(() => {
    if (!animated) return;
    const scheduler = avatarScheduler();
    const node = canvas.current;
    const leave = scheduler.register(target);
    const unobserve = node ? observe(node, target) : () => undefined;
    return () => { unobserve(); leave(); };
  }, [animated, target]);
  useLayoutEffect(() => {
    if (animated) avatarScheduler().update(target);
    else target.paint(state === "waiting" ? { ...RESTING_POSE, state } : RESTING_POSE);
  }, [animated, target, look, state, scale]);

  return <canvas ref={canvas} aria-hidden="true" className={cn("project-avatar", className)} style={{ width: AVATAR_SIZE * scale, height: AVATAR_ROWS * scale }} />;
});

/**
 * The icon of a project wherever one is listed (sidebar, tabs, switchers, phone): its avatar,
 * live from the conversations' state. `size` is the glyph box in CSS pixels; the sprite scales in whole steps.
 */
export function ProjectIcon({ project, size = 15, state, animated = true, className }: { project: Pick<Project, "name" | "appearance"> & { id?: string }; size?: number; state?: AvatarState; animated?: boolean; className?: string }) {
  const live = useProjectAvatarState(state ? undefined : project.id);
  return <ProjectAvatar name={project.name} appearance={project.appearance} state={state ?? live} scale={avatarScale(size)} animated={animated} className={className} />;
}
