/**
 * Command output stored apart (ADR-147): a settled command row over 1 KiB loads with only
 * its last lines (`output`) and its full size (`outputBytes`); the full text is fetched
 * when the person opens it, and kept here for the rows opened most recently.
 */
import type { ActivityItem } from "@/client/types";

/** Full outputs kept in memory (each at most a few KB natively). */
export const TOOL_OUTPUT_CACHE = 48;

/** Whether the row holds only a preview of an output stored apart. */
export function hasStoredOutput(item: Pick<ActivityItem, "outputBytes">): boolean {
  return typeof item.outputBytes === "number" && item.outputBytes > 0;
}

/** A byte count as a short size: "980 B", "48 KB", "1.2 MB". */
export function formatOutputSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function toolOutputKey(sessionId: string, messageId: string, stepId: string): string {
  return `${sessionId}\u0000${messageId}\u0000${stepId}`;
}

/** A bounded, most-recently-used cache of fetched outputs; one fetch per row at a time. */
export function createToolOutputCache(limit = TOOL_OUTPUT_CACHE) {
  const done = new Map<string, string>();
  const pending = new Map<string, Promise<string>>();
  const get = (key: string): string | undefined => {
    const text = done.get(key);
    if (text !== undefined) { done.delete(key); done.set(key, text); }
    return text;
  };
  const remember = (key: string, text: string) => {
    done.delete(key); done.set(key, text);
    while (done.size > limit) done.delete(done.keys().next().value as string);
  };
  const load = (key: string, fetch: () => Promise<string>): Promise<string> => {
    const hit = get(key);
    if (hit !== undefined) return Promise.resolve(hit);
    let request = pending.get(key);
    if (!request) {
      request = fetch().then((text) => { remember(key, text); return text; }).finally(() => pending.delete(key));
      pending.set(key, request);
    }
    return request;
  };
  return { get, load, size: () => done.size };
}

export const toolOutputs = createToolOutputCache();
