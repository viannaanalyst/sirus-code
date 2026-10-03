import type { CommitTitleResult } from "@/client/types";

export type CommitTitleApi = {
  gitCommitTitle(sessionId: string, expectedIndex: string, requestId: string): Promise<CommitTitleResult | null>;
  cancelCommitTitle(sessionId: string, requestId: string): Promise<void>;
};
export type TitleOutcome = { type: "title"; result: CommitTitleResult } | { type: "discarded" } | { type: "cancelled" } | { type: "error"; reason: unknown };
/** One owner-bound request; cancellation invalidates publication immediately but pending lasts until generation settles. */
export class CommitTitleRequest {
  private valid = true;
  private cancellation: Promise<void> | null = null;
  private api: CommitTitleApi;
  private sessionId: string;
  private index: string;
  readonly requestId: string;
  private revision: number;
  constructor(api: CommitTitleApi, sessionId: string, index: string, requestId: string, revision: number) {
    this.api = api; this.sessionId = sessionId; this.index = index; this.requestId = requestId; this.revision = revision;
  }
  invalidate() { this.valid = false; }
  cancel(): Promise<void> {
    this.invalidate();
    return this.cancellation ??= this.api.cancelCommitTitle(this.sessionId, this.requestId);
  }
  async generate(current: () => { sessionId: string; index: string | null; revision: number; alive: boolean }): Promise<TitleOutcome> {
    const eligible = () => {
      const owner = current();
      return this.valid && owner.alive && owner.sessionId === this.sessionId && owner.index === this.index && owner.revision === this.revision;
    };
    try {
      const result = await this.api.gitCommitTitle(this.sessionId, this.index, this.requestId);
      if (!this.valid || !current().alive) return { type: "cancelled" };
      if (!eligible()) return { type: "discarded" };
      return result ? { type: "title", result } : { type: "cancelled" };
    } catch (reason) {
      if (!this.valid || !current().alive) return { type: "cancelled" };
      return eligible() ? { type: "error", reason } : { type: "discarded" };
    }
  }
}
