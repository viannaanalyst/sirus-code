/**
 * A send whose answer never came (the connection dropped or the computer did not answer in
 * time) may still have reached it. Sending the same text again from the same composer reuses
 * that send's `clientRequestId`, so the computer recognises the retry instead of starting a
 * second turn. Any other text, or a send that was answered, starts fresh.
 */
const unanswered = new Map<string, { prompt: string; id: string }>();
const LIMIT = 32;

export function rememberUnanswered(owner: string, prompt: string, id: string) {
  unanswered.delete(owner);
  unanswered.set(owner, { prompt, id });
  while (unanswered.size > LIMIT) unanswered.delete(unanswered.keys().next().value!);
}

export function retryIdFor(owner: string, prompt: string): string | undefined {
  const entry = unanswered.get(owner);
  return entry && entry.prompt === prompt ? entry.id : undefined;
}

export function forgetUnanswered(owner: string) {
  unanswered.delete(owner);
}
