/**
 * When streamed `agent-output` deltas reach the store (ADR-180). Native batching already
 * folds a token burst into one event per 16 ms; this decides how often the renderer
 * applies them:
 *
 * - a conversation on screen, at most every `VISIBLE_INTERVAL` (about 30 per second),
 *   aligned to an animation frame;
 * - a conversation that is not on screen, or any conversation while the document is
 *   hidden, once per `BACKGROUND_INTERVAL`, and at the next visible flush once shown.
 *
 * Events of a session stay in arrival order; nothing is dropped or merged.
 */
export const VISIBLE_INTERVAL = 33;
export const BACKGROUND_INTERVAL = 250;

export interface OutputSchedulerHost<E extends { sessionId: string }> {
  apply(events: E[]): void;
  /** Sessions whose transcript is on screen right now. */
  isVisible(sessionId: string): boolean;
  documentHidden(): boolean;
  now(): number;
  frame(callback: () => void): () => void;
  timer(callback: () => void, ms: number): () => void;
}

export class OutputScheduler<E extends { sessionId: string }> {
  private pending = new Map<string, E[]>();
  private cancelFrame: (() => void) | null = null;
  private cancelTimer: (() => void) | null = null;
  private lastVisibleFlush = Number.NEGATIVE_INFINITY;
  /** How many times `apply` ran; tests and diagnostics read it. */
  flushes = 0;

  private readonly host: OutputSchedulerHost<E>;

  constructor(host: OutputSchedulerHost<E>) { this.host = host; }

  queue(event: E) {
    const queued = this.pending.get(event.sessionId);
    if (queued) queued.push(event); else this.pending.set(event.sessionId, [event]);
    this.schedule();
  }

  /** Applies everything now (a session was opened, the stream ended). */
  flush() {
    this.clear();
    this.apply(() => true);
  }

  cancel() {
    this.clear();
    this.pending = new Map();
  }

  private clear() {
    this.cancelFrame?.(); this.cancelFrame = null;
    this.cancelTimer?.(); this.cancelTimer = null;
  }

  private schedule() {
    const hidden = this.host.documentHidden();
    if (!hidden && !this.cancelFrame && [...this.pending.keys()].some((id) => this.host.isVisible(id))) {
      // A frame runs about every 16 ms; one that lands inside the interval is skipped.
      this.cancelFrame = this.host.frame(() => {
        this.cancelFrame = null;
        if (this.host.now() < this.lastVisibleFlush + VISIBLE_INTERVAL) { this.schedule(); return; }
        this.lastVisibleFlush = this.host.now();
        this.apply((id) => this.host.isVisible(id));
        if (this.pending.size) this.schedule();
      });
    }
    if (!this.cancelTimer && (hidden || [...this.pending.keys()].some((id) => !this.host.isVisible(id)))) {
      this.cancelTimer = this.host.timer(() => {
        this.cancelTimer = null;
        this.apply(() => true);
      }, BACKGROUND_INTERVAL);
    }
  }

  private apply(take: (sessionId: string) => boolean) {
    const events: E[] = [];
    for (const [id, queued] of this.pending) {
      if (!take(id)) continue;
      events.push(...queued);
      this.pending.delete(id);
    }
    if (!events.length) return;
    this.flushes += 1;
    this.host.apply(events);
  }
}
