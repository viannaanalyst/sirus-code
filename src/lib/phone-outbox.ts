import type { ExecutionOptions } from "@/client/types";
import { newRequestId } from "@/lib/ids";

/**
 * Messages written on the phone while the Mac is out of reach (ADR-086). They wait in
 * the phone's storage and go out in order, oldest first, once the connection is back.
 * Text only: attachments live on the Mac and need it to be reachable. Each keeps one
 * `clientRequestId` for every try, so a send whose answer was lost is not run twice.
 */
export interface QueuedMessage { id: string; sessionId: string; prompt: string; execution?: ExecutionOptions; createdAt: number; clientRequestId?: string }

const KEY = "sirus.outbox";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function readOutbox(storage: Storage = localStorage): QueuedMessage[] {
  try {
    const value = JSON.parse(storage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is QueuedMessage => typeof item?.id === "string" && typeof item.sessionId === "string" && typeof item.prompt === "string") : [];
  } catch {
    return [];
  }
}

function write(items: QueuedMessage[], storage: Storage) {
  storage.setItem(KEY, JSON.stringify(items));
  globalThis.window?.dispatchEvent(new Event("sirus-outbox"));
}

export function enqueueMessage(message: Omit<QueuedMessage, "id" | "createdAt" | "clientRequestId">, storage: Storage = localStorage): QueuedMessage {
  const item = { ...message, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now(), clientRequestId: newRequestId() };
  write([...readOutbox(storage), item].slice(-50), storage);
  return item;
}

export function removeQueued(id: string, storage: Storage = localStorage) {
  write(readOutbox(storage).filter((item) => item.id !== id), storage);
}

/**
 * Moves a message one place earlier or later among its conversation's waiting messages;
 * messages of other conversations keep their places. False when it cannot move that way.
 */
export function moveQueued(id: string, delta: -1 | 1, storage: Storage = localStorage): boolean {
  const items = readOutbox(storage);
  const at = items.findIndex((item) => item.id === id);
  if (at < 0) return false;
  const peers = items.flatMap((item, index) => item.sessionId === items[at].sessionId ? [index] : []);
  const other = peers[peers.indexOf(at) + delta];
  if (other === undefined) return false;
  const next = [...items];
  [next[at], next[other]] = [next[other], next[at]];
  write(next, storage);
  return true;
}

/**
 * Sends what waits, in order; a message that fails stays and the rest wait behind it.
 * `here` picks the messages the active computer can take (ADR-132); the others keep waiting.
 */
export async function flushOutbox(send: (message: QueuedMessage) => Promise<boolean>, storage: Storage = localStorage, here: (message: QueuedMessage) => boolean = () => true): Promise<number> {
  let sent = 0;
  for (const message of readOutbox(storage)) {
    if (!here(message)) continue;
    if (!await send(message).catch(() => false)) break;
    removeQueued(message.id, storage);
    sent += 1;
  }
  return sent;
}

/** A conversation continued on another computer takes its waiting messages along, in order. */
export function retargetQueued(fromSessionId: string, toSessionId: string, storage: Storage = localStorage): number {
  const items = readOutbox(storage);
  const moved = items.filter((item) => item.sessionId === fromSessionId).length;
  if (moved) write(items.map((item) => item.sessionId === fromSessionId ? { ...item, sessionId: toSessionId } : item), storage);
  return moved;
}
