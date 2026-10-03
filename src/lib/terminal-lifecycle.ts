// Serialize start/stop for a session across React effect cleanup and StrictMode replay.
const pending = new Map<string, Promise<void>>();
export function queueTerminalOperation(sessionId: string, operation: () => Promise<void>): Promise<void> {
  const previous = pending.get(sessionId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  pending.set(sessionId, next);
  void next.finally(() => { if (pending.get(sessionId) === next) pending.delete(sessionId); }).catch(() => undefined);
  return next;
}
