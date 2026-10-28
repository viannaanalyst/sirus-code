import type { Session } from "@/client/types";
import type { AvatarState } from "@/lib/project-avatar";
import { tabStatus } from "@/lib/header-tabs";

/**
 * What each project's avatar shows, from the signals the sidebar already has: a conversation that
 * needs the person (waiting, or finished while they were elsewhere) makes the avatar happy with
 * the violet notch; otherwise a running conversation makes it work. Projects at rest are absent.
 */
export function projectAvatarStates(sessions: readonly Session[], unseen: ReadonlySet<string>, computerWaiting: ReadonlySet<string>): Record<string, AvatarState> {
  const out: Record<string, AvatarState> = {};
  for (const session of sessions) {
    const status = tabStatus(session, unseen, computerWaiting);
    if (status === "waiting" || status === "done") out[session.projectId] = "waiting";
    else if (status === "running" && out[session.projectId] !== "waiting") out[session.projectId] = "working";
  }
  return out;
}

let from: [readonly Session[], readonly string[] | undefined, unknown] | null = null;
let last: Record<string, AvatarState> = {};
/** Memoised on the lists it reads, so many avatars cost one pass per change rather than one each. */
export function memoProjectAvatarStates(sessions: readonly Session[], unseenIds: readonly string[], requests: ReadonlyArray<{ sessionId: string }> | undefined): Record<string, AvatarState> {
  if (from && from[0] === sessions && from[1] === unseenIds && from[2] === requests) return last;
  from = [sessions, unseenIds, requests];
  const next = projectAvatarStates(sessions, new Set(unseenIds), new Set((requests ?? []).map((request) => request.sessionId)));
  // Keep the previous object when nothing changed so subscribers do not re-render.
  const same = Object.keys(next).length === Object.keys(last).length && Object.entries(next).every(([id, state]) => last[id] === state);
  if (!same) last = next;
  return last;
}
