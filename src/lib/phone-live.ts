import type { Session } from "@/client/types";
import { isWorking, needsYou } from "@/lib/mobile";
import { isAuxiliarySession } from "@/lib/pull-ask";

/**
 * Live state the phone app shows outside the transcript (ADR-124): the home-screen icon's
 * badge and the floating "Working" pill. Pure; the clock and `navigator` are passed in.
 */

/** Conversations waiting on the person (an approval, a question or their reply), archived ones aside. */
export function needsYouCount(sessions: readonly Session[], archived: readonly string[]): number {
  const hidden = new Set(archived);
  return sessions.filter((session) => !isAuxiliarySession(session) && !hidden.has(session.id) && needsYou(session)).length;
}

type BadgeNavigator = { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

/**
 * The app icon's badge (Badging API; iOS 16.4+ home-screen apps with alerts allowed).
 * Unsupported browsers and refusals are quiet: the badge is a nicety, never an error.
 */
export async function syncAppBadge(count: number, target: BadgeNavigator | undefined = globalThis.navigator as BadgeNavigator | undefined): Promise<boolean> {
  if (!target?.setAppBadge) return false;
  try {
    if (count > 0) await target.setAppBadge(count);
    else if (target.clearAppBadge) await target.clearAppBadge();
    else await target.setAppBadge(0);
    return true;
  } catch {
    return false;
  }
}

/** When the turn that is running began, minus the time it waited on the person; null when it is not working. */
export function workingClock(session: Session): { startedAt: number; pausedMs: number } | null {
  if (!isWorking(session)) return null;
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (message.activity && message.activity.endedAt === null) return { startedAt: message.activity.startedAt, pausedMs: message.activity.pausedMs };
    if (message.role === "user") {
      const at = Date.parse(message.createdAt);
      return Number.isFinite(at) ? { startedAt: at, pausedMs: 0 } : null;
    }
  }
  return null;
}

/** Whole seconds the turn has worked at `now`, never negative. */
export function workingSeconds(clock: { startedAt: number; pausedMs: number }, now: number): number {
  return Math.max(0, Math.floor((now - clock.startedAt - clock.pausedMs) / 1000));
}
