/** How recent a message must be, when its row first mounts, to play the send animation. */
export const FRESH_MESSAGE_MS = 1500;

/**
 * Whether a row is a message just sent or just started (it plays the send animation once),
 * not one loaded with the transcript or shown again after switching sessions.
 */
export function isFreshMessage(createdAt: string, now = Date.now()): boolean {
  const at = Date.parse(createdAt);
  return Number.isFinite(at) && now - at >= -FRESH_MESSAGE_MS && now - at < FRESH_MESSAGE_MS;
}
