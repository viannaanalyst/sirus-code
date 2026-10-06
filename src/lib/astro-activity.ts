import type { Astro, Session } from "@/client/types";
import type { AstroActivity } from "@/lib/astro-art";

/**
 * What an Astro is doing, for its icon (ADR-069): waiting for the person when
 * its conversation or a session it delegated asks for something, working while
 * either is running, idle otherwise.
 */
export function astroActivity(astro: Pick<Astro, "id" | "sessionId">, sessions: readonly Pick<Session, "id" | "status" | "delegation">[]): AstroActivity {
  const own = sessions.filter((session) => session.id === astro.sessionId || (session.delegation?.astroId === astro.id && !session.delegation.settled));
  if (own.some((session) => session.status === "waiting")) return "needs-you";
  if (own.some((session) => session.status === "running" || session.status === "starting")) return "working";
  return "idle";
}
