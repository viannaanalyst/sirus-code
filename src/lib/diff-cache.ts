// In-memory caches for diff viewing (ADR-145): parsed diffs keyed by their text and fetched
// pull request diffs keyed by head commit. Both are bounded by entry count and total weight,
// evicting the least recently used entry first.
import { reviewDiffLines } from "./diff-comment";
import type { DiffLine } from "./transcript";

export class BoundedCache<K, V> {
  private entries = new Map<K, { value: V; weight: number }>();
  private total = 0;
  private readonly maxEntries: number;
  private readonly maxWeight: number;
  constructor(maxEntries: number, maxWeight = Number.POSITIVE_INFINITY) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
    this.maxWeight = maxWeight;
  }

  get size() { return this.entries.size; }
  get weight() { return this.total; }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    // Re-insert so the Map's order stays least- to most-recently used.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  has(key: K) { return this.entries.has(key); }

  /** Stores `value`; an entry heavier than the whole budget is not kept. */
  set(key: K, value: V, weight = 1): V {
    this.delete(key);
    const size = Number.isFinite(weight) && weight > 0 ? weight : 0;
    if (size > this.maxWeight) return value;
    this.entries.set(key, { value, weight: size });
    this.total += size;
    for (const [oldest, entry] of this.entries) {
      if (this.entries.size <= this.maxEntries && this.total <= this.maxWeight) break;
      this.entries.delete(oldest);
      this.total -= entry.weight;
    }
    return value;
  }

  delete(key: K) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.total -= entry.weight;
    return true;
  }

  clear() { this.entries.clear(); this.total = 0; }
}

/** Parsed diffs: about 24 MB of diff text, or 96 files, whichever comes first. */
export const PARSED_DIFF_MAX_ENTRIES = 96;
export const PARSED_DIFF_MAX_CHARS = 24 * 1024 * 1024;
const parsed = new BoundedCache<string, DiffLine[]>(PARSED_DIFF_MAX_ENTRIES, PARSED_DIFF_MAX_CHARS);

/**
 * The rows of a diff, parsed once per text. The same array comes back while it stays cached,
 * so memoized rows, find results and highlighting (keyed by this array) are reused when a
 * review tab or file is opened again.
 */
export function cachedDiffLines(diff: string): DiffLine[] {
  if (!diff) return EMPTY_LINES;
  return parsed.get(diff) ?? parsed.set(diff, reviewDiffLines(diff), diff.length);
}
const EMPTY_LINES: DiffLine[] = [];

/** For tests: forget every parsed diff. */
export function clearParsedDiffs() { parsed.clear(); }
