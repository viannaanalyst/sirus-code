import { test } from "node:test";
import assert from "node:assert/strict";
import { sameRowProps, type TranscriptRowProps } from "../src/lib/transcript-row.ts";
import type { Message, Session, Team } from "../src/client/types.ts";

const message = (id: string, content: string): Message => ({ id, sessionId: "s", role: "agent", content, createdAt: "t", streaming: false });
const session = (messages: Message[], extra: Partial<Session> = {}): Session => ({ id: "s", projectId: "p", title: "Task", agent: "codex", status: "running", createdAt: "t", lastActivityAt: "t", worktree: { path: "/fixture", branch: "main", isolated: false }, messages, lastError: null, ...extra });
const nodes = { current: new Map() };

test("a streamed frame re-renders only the row whose message changed", () => {
  const first = message("a", "done"), streaming = message("b", "par");
  const before = session([first, streaming]);
  // What the store does per flushed frame: a new session and messages array, earlier messages kept.
  const after = { ...before, messages: [first, { ...streaming, content: "partial" }], worktree: { ...before.worktree } };
  const row = (current: Session, item: Message): TranscriptRowProps => ({ message: item, session: current, searchQuery: "", nodes });
  assert.equal(sameRowProps(row(before, first), row(after, first)), true, "an unchanged row skips the frame");
  assert.equal(sameRowProps(row(before, streaming), row(after, after.messages[1])), false, "the streaming row renders");
});

test("a row still renders when a session field it reads changes", () => {
  const item = message("a", "done");
  const base = session([item]);
  const row = (current: Session, extra: Partial<TranscriptRowProps> = {}): TranscriptRowProps => ({ message: item, session: current, searchQuery: "", nodes, ...extra });
  for (const change of [{ status: "completed" }, { agent: "claude" }, { model: "m" }, { astro: "x" }, { pinnedMessageIds: ["a"] }, { worktree: { path: "/other", branch: "main", isolated: false } }, { sideChat: { parentSessionId: "p" } }, { execution: { approval: "auto" } }] as Partial<Session>[]) {
    assert.equal(sameRowProps(row(base), row({ ...base, ...change })), false, JSON.stringify(change));
  }
  assert.equal(sameRowProps(row(base), row(base, { searchQuery: "q" })), false);
  assert.equal(sameRowProps(row(base), row(base, { last: true })), false);
  assert.equal(sameRowProps(row(base), row(base, { compacted: true })), false);
});

test("a new team object re-renders only the coordinator's row", () => {
  const coordinator = message("a", "plan"), other = message("b", "later");
  const team = { messageId: "a" } as Team;
  const before = session([coordinator, other], { team });
  const after = { ...before, team: { ...team } };
  const row = (current: Session, item: Message): TranscriptRowProps => ({ message: item, session: current, searchQuery: "", nodes });
  assert.equal(sameRowProps(row(before, coordinator), row(after, coordinator)), false);
  assert.equal(sameRowProps(row(before, other), row(after, other)), true);
});
