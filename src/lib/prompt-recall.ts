/**
 * Composer conveniences after T3 Code: terminal-style recall of sent prompts (↑/↓) and a
 * per-composer stash of drafts set aside with ⌘S.
 */
export interface Recall { index: number | null; draft: string }

/**
 * One ↑ (-1) or ↓ (+1) step through `sent` (oldest first). Browsing starts only from an empty
 * composer; ↓ past the newest entry restores the draft that was there. `null` = not handled.
 */
export function recallStep(sent: readonly string[], state: Recall, value: string, direction: -1 | 1): { state: Recall; value: string } | null {
  if (!sent.length) return null;
  if (state.index === null) {
    if (direction === 1 || value.trim()) return null;
    return { state: { index: sent.length - 1, draft: value }, value: sent[sent.length - 1] };
  }
  const next = state.index + direction;
  if (next < 0) return { state, value: sent[state.index] };
  if (next >= sent.length) return { state: { index: null, draft: "" }, value: state.draft };
  return { state: { index: next, draft: state.draft }, value: sent[next] };
}

const stashKey = (owner: string) => `sirus:prompt-stash:${owner}`;
const MAX_STASH = 20;

export function readStash(owner: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(stashKey(owner)) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, MAX_STASH) : [];
  } catch { return []; }
}

export function writeStash(owner: string, items: readonly string[]) {
  try {
    if (items.length) localStorage.setItem(stashKey(owner), JSON.stringify(items.slice(0, MAX_STASH)));
    else localStorage.removeItem(stashKey(owner));
  } catch { /* storage full or unavailable: the stash stays in memory */ }
}
