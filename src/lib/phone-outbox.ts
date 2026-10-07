import type { ExecutionOptions } from "@/client/types";

/**
 * Messages written on the phone while the Mac is out of reach (ADR-086). They wait in
 * the phone's storage and go out in order, oldest first, once the connection is back.
 * Text only: attachments live on the Mac and need it to be reachable.
 */
export interface QueuedMessage { id: string; sessionId: string; prompt: string; execution?: ExecutionOptions; createdAt: number }

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

export function enqueueMessage(message: Omit<QueuedMessage, "id" | "createdAt">, storage: Storage = localStorage): QueuedMessage {
  const item = { ...message, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now() };
  write([...readOutbox(storage), item].slice(-50), storage);
  return item;
}

export function removeQueued(id: string, storage: Storage = localStorage) {
  write(readOutbox(storage).filter((item) => item.id !== id), storage);
}

/** Sends what waits, in order; a message that fails stays and the rest wait behind it. */
export async function flushOutbox(send: (message: QueuedMessage) => Promise<boolean>, storage: Storage = localStorage): Promise<number> {
  let sent = 0;
  for (const message of readOutbox(storage)) {
    if (!await send(message).catch(() => false)) break;
    removeQueued(message.id, storage);
    sent += 1;
  }
  return sent;
}
