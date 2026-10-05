import type { ProviderUsage } from "@/client/types";

/** Sent when the session continues after its usage limit resets. */
export const CONTINUE_PROMPT = "Continue from where you left off.";
/** Providers can still refuse right at the reset; give them a moment. */
export const RESUME_GRACE_MS = 30_000;
/** Timers stall while the Mac sleeps, so an armed resume rechecks at least this often. */
export const RESUME_RECHECK_MS = 5 * 60_000;

/** The latest reset among the windows the provider reports as spent. */
export function exhaustedReset(usage: ProviderUsage | null | undefined): number | null {
  const resets = (usage?.windows ?? []).filter((window) => (window.usedPercent ?? 0) >= 100 && window.resetsAt != null).map((window) => window.resetsAt as number);
  return resets.length ? Math.max(...resets) : null;
}

/** "in 4h 42m", "in 12m", "in 1d 4h". */
export function resetDistance(ms: number): { days: number; hours: number; minutes: number } {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return { days: Math.floor(minutes / 1440), hours: Math.floor((minutes % 1440) / 60), minutes: minutes % 60 };
}

/** When an armed resume should fire, or null when it cannot be scheduled. */
export function resumeAt(resetsAt: number | null | undefined): number | null {
  return resetsAt == null ? null : resetsAt + RESUME_GRACE_MS;
}
