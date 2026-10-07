import type { Session } from "@/client/types";

/** Providers whose native adapter compacts on `/compact` (ADR-057). */
export const COMPACTING_PROVIDERS = new Set(["codex", "claude"]);
/** A heavy context: at least this many tokens, or this share of a known window. */
export const COMPACT_TOKENS = 100_000;
export const COMPACT_RATIO = 0.7;
/** Long enough that the provider's prompt cache has expired, so a resend pays full price. */
export const COMPACT_IDLE_MS = 70 * 60 * 1000;

/**
 * "Compact and send" (T3 Code #16631): a heavy conversation coming back after a long pause
 * compacts first, so the next request does not resend the whole uncached context.
 */
export function shouldCompactBeforeSend(session: Pick<Session, "agent" | "status" | "nativeThread" | "contextUsage" | "lastActivityAt"> | null, now: number): boolean {
  if (!session || !COMPACTING_PROVIDERS.has(session.agent) || !session.nativeThread) return false;
  if (["starting", "running", "waiting"].includes(session.status)) return false;
  const usage = session.contextUsage;
  if (!usage || !(usage.used >= COMPACT_TOKENS || (usage.window ? usage.used / usage.window >= COMPACT_RATIO : false))) return false;
  const last = Date.parse(session.lastActivityAt);
  return Number.isFinite(last) && now - last > COMPACT_IDLE_MS;
}
