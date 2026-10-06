import type { AgentProviderId } from "@/client/types";

/**
 * Memory-only signals for the provider switch motion: the composer announces a
 * switch made in its model picker (the owner's pane plays the 5 s scene), and
 * the pending handoff card leaves its last position so the transcript marker
 * can fly it into place after Send. Nothing here reaches native code.
 */

export interface ProviderSwitch { owner: string; to: AgentProviderId; at: number }

type Listener = (change: ProviderSwitch) => void;
const listeners = new Set<Listener>();

/** `owner` is the session id, or `landing` before the first send. */
export function announceProviderSwitch(owner: string, to: AgentProviderId) {
  const change = { owner, to, at: performance.now() };
  for (const listener of [...listeners]) listener(change);
}

export function subscribeProviderSwitch(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const cards = new Map<string, { rect: DOMRect; at: number }>();

export function rememberHandoffCard(sessionId: string, rect: DOMRect) {
  cards.set(sessionId, { rect, at: performance.now() });
}

export function forgetHandoffCard(sessionId: string) {
  cards.delete(sessionId);
}

/** The card's last place if it was on screen within `maxAge` ms; read once. */
export function takeHandoffCard(sessionId: string, maxAge = 8000) {
  const card = cards.get(sessionId);
  cards.delete(sessionId);
  return card && performance.now() - card.at <= maxAge ? card.rect : null;
}
