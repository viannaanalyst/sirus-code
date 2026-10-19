// Syntax colours for diffs (ADR-145), computed off the UI thread. A file's lines are split into
// segments (hunks, at most DIFF_SEGMENT_LINES lines each); the viewer asks for the segments
// near the viewport, a web worker tokenizes them with the app's highlighter (code-tokens.ts),
// and rows show plain text until their segment arrives. Results are kept per parsed-lines array
// (WeakMap), so they live exactly as long as the parsed diff stays cached (diff-cache.ts).
import { codeTokens, TOKEN_KINDS, type TokenKind } from "./code-tokens";
import type { DiffLine } from "./transcript";

export const DIFF_SEGMENT_LINES = 400;
/** Segments queued beyond the visible ones, so a short scroll finds its colours ready. */
export const DIFF_PREFETCH_SEGMENTS = 2;

/** Old side, new side, or both (context). Header rows are not code. */
export const SIDE_OLD = 1, SIDE_NEW = 2, SIDE_BOTH = 3, SIDE_NONE = 0;

export interface SegmentPayload { texts: string[]; sides: Uint8Array }
/** Per segment line: tokens as [start, end, kind] triples, offsets in the line's text without its +/−/space marker. */
export interface SegmentTokens { starts: Uint32Array; tokens: Uint32Array }

const segmentCache = new WeakMap<readonly DiffLine[], Int32Array>();
/** Start line of each segment: a new one at every hunk header and every DIFF_SEGMENT_LINES lines. */
export function diffSegments(lines: readonly DiffLine[], size = DIFF_SEGMENT_LINES): Int32Array {
  const cached = size === DIFF_SEGMENT_LINES ? segmentCache.get(lines) : undefined;
  if (cached) return cached;
  const starts: number[] = [];
  let begun = -1;
  for (let index = 0; index < lines.length; index++) {
    if (begun < 0 || (lines[index].kind === "header" && index > begun && lines[index - 1].kind !== "header") || index - begun >= size) { starts.push(index); begun = index; }
  }
  const result = Int32Array.from(starts);
  if (size === DIFF_SEGMENT_LINES) segmentCache.set(lines, result);
  return result;
}

/** Index of the segment holding `line`. */
export function segmentOf(segments: Int32Array, line: number): number {
  let low = 0, high = segments.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (segments[middle] <= line) low = middle; else high = middle - 1;
  }
  return low;
}

export function segmentPayload(lines: readonly DiffLine[], from: number, to: number): SegmentPayload {
  const texts: string[] = [];
  const sides = new Uint8Array(Math.max(0, to - from));
  for (let index = from; index < to; index++) {
    const line = lines[index];
    sides[index - from] = line.kind === "addition" ? SIDE_NEW : line.kind === "deletion" ? SIDE_OLD : line.kind === "context" ? SIDE_BOTH : SIDE_NONE;
    texts.push(sides[index - from] === SIDE_NONE ? "" : line.content.slice(1));
  }
  return { texts, sides };
}

/**
 * Tokenizes a segment. The old and the new side are each joined back into source text before
 * tokenizing, so a block comment or template string spanning lines colours every line it
 * covers; tokens are then cut at line breaks. Context lines take the new side's tokens.
 */
export function tokenizeSegment(payload: SegmentPayload, language: string): SegmentTokens {
  const count = payload.sides.length;
  const perLine: number[][] = Array.from({ length: count }, () => []);
  for (const side of [SIDE_OLD, SIDE_NEW]) {
    const members: number[] = [];
    for (let index = 0; index < count; index++) if (payload.sides[index] & side) members.push(index);
    if (!members.length) continue;
    // Context lines belong to both sides; only the new side writes their tokens.
    const writes = (member: number) => side === SIDE_NEW || payload.sides[member] !== SIDE_BOTH;
    const starts: number[] = [];
    let at = 0;
    for (const member of members) { starts.push(at); at += payload.texts[member].length + 1; }
    const source = members.map((member) => payload.texts[member]).join("\n");
    let cursor = 0;
    for (const token of codeTokens(source, language)) {
      while (cursor + 1 < starts.length && starts[cursor + 1] <= token.start) cursor++;
      const kind = TOKEN_KINDS.indexOf(token.kind);
      // Cut the token at each line break it spans.
      for (let part = cursor, from = token.start; part < starts.length && from < token.end; part++) {
        const lineStart = starts[part], lineEnd = lineStart + payload.texts[members[part]].length;
        const end = Math.min(token.end, lineEnd);
        if (end > from && writes(members[part])) perLine[members[part]].push(from - lineStart, end - lineStart, kind);
        from = lineEnd + 1;
      }
    }
  }
  const starts = new Uint32Array(count + 1);
  let total = 0;
  for (let index = 0; index < count; index++) { starts[index] = total; total += perLine[index].length; }
  starts[count] = total;
  const tokens = new Uint32Array(total);
  perLine.forEach((values, index) => tokens.set(values, starts[index]));
  return { starts, tokens };
}

/** Text split into plain and coloured pieces; `offset` skips the marker column. */
export function splitByTokens(text: string, tokens: Uint32Array | undefined, offset = 1): { text: string; kind: TokenKind | null }[] {
  if (!tokens?.length) return [{ text, kind: null }];
  const parts: { text: string; kind: TokenKind | null }[] = [];
  let at = 0;
  for (let index = 0; index + 2 < tokens.length; index += 3) {
    const start = tokens[index] + offset, end = Math.min(text.length, tokens[index + 1] + offset);
    if (start < at || end <= start) continue;
    if (start > at) parts.push({ text: text.slice(at, start), kind: null });
    parts.push({ text: text.slice(start, end), kind: TOKEN_KINDS[tokens[index + 2]] ?? null });
    at = end;
  }
  if (at < text.length || !parts.length) parts.push({ text: text.slice(at), kind: null });
  return parts;
}

export interface HighlightRequest { id: number; language: string; payload: SegmentPayload }
export interface HighlightResponse { id: number; result: SegmentTokens | null }

type Ready = { tokens: SegmentTokens; lines: (Uint32Array | undefined)[] };
interface Job { id: number; lines: readonly DiffLine[]; language: string; segment: number }

/**
 * One worker for the app, one job at a time. `want` replaces the queue with what the viewer
 * needs now, nearest first, so scrolling away drops work that is no longer useful.
 */
export class DiffHighlighter {
  private ready = new WeakMap<readonly DiffLine[], Map<number, Ready>>();
  private queue: Job[] = [];
  private active: Job | null = null;
  private worker: Worker | null = null;
  private failed = false;
  private sequence = 0;
  private listeners = new Set<() => void>();
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly createWorker: (() => Worker) | null;
  constructor(createWorker: (() => Worker) | null) { this.createWorker = createWorker; }

  get available() { return !!this.createWorker && !this.failed; }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  /** Tokens of line `line`, or undefined while its segment is not ready. Stable per line. */
  tokensFor(lines: readonly DiffLine[], line: number): Uint32Array | undefined {
    const byFile = this.ready.get(lines);
    if (!byFile) return undefined;
    const segments = diffSegments(lines);
    const segment = segmentOf(segments, line);
    const ready = byFile.get(segment);
    if (!ready) return undefined;
    const local = line - segments[segment];
    if (local < 0 || local >= ready.tokens.starts.length - 1) return undefined;
    let cached = ready.lines[local];
    if (!cached) {
      cached = ready.tokens.tokens.subarray(ready.tokens.starts[local], ready.tokens.starts[local + 1]);
      ready.lines[local] = cached;
    }
    return cached;
  }

  /** Asks for the segments covering each range, in the given order, plus a few beyond. */
  want(ranges: readonly { lines: readonly DiffLine[]; language: string; from: number; to: number }[]) {
    if (!this.available) return;
    const jobs: Job[] = [];
    const seen = new Map<readonly DiffLine[], Set<number>>();
    const add = (lines: readonly DiffLine[], language: string, segment: number) => {
      let taken = seen.get(lines);
      if (!taken) seen.set(lines, taken = new Set());
      if (taken.has(segment) || this.ready.get(lines)?.has(segment)) return;
      taken.add(segment);
      if (this.active?.lines === lines && this.active.segment === segment) return;
      jobs.push({ id: 0, lines, language, segment });
    };
    const later: [readonly DiffLine[], string, number][] = [];
    for (const range of ranges) {
      if (!range.lines.length || range.to <= range.from) continue;
      const segments = diffSegments(range.lines);
      const first = segmentOf(segments, range.from), last = segmentOf(segments, Math.max(range.from, range.to - 1));
      for (let segment = first; segment <= last; segment++) add(range.lines, range.language, segment);
      for (let extra = 1; extra <= DIFF_PREFETCH_SEGMENTS; extra++) {
        if (last + extra < segments.length) later.push([range.lines, range.language, last + extra]);
        if (first - extra >= 0) later.push([range.lines, range.language, first - extra]);
      }
    }
    for (const [lines, language, segment] of later) add(lines, language, segment);
    this.queue = jobs;
    this.pump();
  }

  private pump() {
    if (this.active || !this.queue.length || !this.available) return;
    const job = this.queue.shift()!;
    job.id = ++this.sequence;
    this.active = job;
    const segments = diffSegments(job.lines);
    const from = segments[job.segment], to = job.segment + 1 < segments.length ? segments[job.segment + 1] : job.lines.length;
    try {
      const worker = this.worker ?? this.start();
      worker.postMessage({ id: job.id, language: job.language, payload: segmentPayload(job.lines, from, to) } satisfies HighlightRequest);
    } catch { this.fail(); }
  }

  private start(): Worker {
    const worker = this.createWorker!();
    worker.onmessage = ({ data }: MessageEvent<HighlightResponse>) => {
      const job = this.active;
      if (!job || job.id !== data.id) return;
      this.active = null;
      if (data.result) {
        let byFile = this.ready.get(job.lines);
        if (!byFile) this.ready.set(job.lines, byFile = new Map());
        byFile.set(job.segment, { tokens: data.result, lines: [] });
        this.notify();
      }
      this.pump();
    };
    worker.onerror = () => { if (this.worker === worker) this.fail(); };
    this.worker = worker;
    return worker;
  }

  private fail() {
    this.failed = true;
    this.worker?.terminate();
    this.worker = null;
    this.active = null;
    this.queue = [];
  }

  /** Segments landing close together repaint once. A timer, not an animation frame: frames
   * stop while the window is hidden, and colours that arrived meanwhile must still show. */
  private notify() {
    if (this.notifyTimer !== null) return;
    this.notifyTimer = setTimeout(() => { this.notifyTimer = null; for (const listener of this.listeners) listener(); }, 16);
  }
}

let shared: DiffHighlighter | null = null;
/** The app's highlighter; without Worker support (tests, server rendering) rows stay plain. */
export function diffHighlighter(): DiffHighlighter {
  shared ??= new DiffHighlighter(typeof Worker === "undefined" ? null : () => new Worker(new URL("./diff-highlight.worker.ts", import.meta.url), { type: "module" }));
  return shared;
}
