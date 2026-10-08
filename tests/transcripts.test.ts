import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateMessageBytes, estimateTranscriptBytes, hasConversation, keepSentOutputs, mergeLoadedTranscript, mergeSessionEvent, transcriptsToKeep } from "../src/lib/transcripts.ts";
import type { Message, Session } from "../src/client/types.ts";

const message = (id: string, role: Message["role"], content: string): Message => ({ id, sessionId: "s", role, content, createdAt: "t", streaming: false });
const session = (messages: Message[], extra: Partial<Session> = {}): Session => ({ id: "s", projectId: "p", title: "Task", agent: "codex", status: "completed", createdAt: "t", lastActivityAt: "t", worktree: { path: "/fixture", branch: "main", isolated: false }, messages, lastError: null, ...extra });

test("a windowed event splices the current turn into a loaded transcript", () => {
  const held = session([message("u1", "user", "first"), message("a1", "agent", "reply"), message("u2", "user", "next"), message("a2", "agent", "partial")]);
  const event = session([message("u2", "user", "next"), { ...message("a2", "agent", "partial and done"), activity: null }], { status: "completed", transcriptLength: 4, transcriptWindow: { from: 2, total: 4 } });
  const { session: merged, reload } = mergeSessionEvent(held, event, true);
  assert.equal(reload, false);
  assert.deepEqual(merged.messages.map(item => item.content), ["first", "reply", "next", "partial and done"]);
  assert.equal(merged.messages[0], held.messages[0], "earlier messages keep their identity");
  assert.equal("transcriptWindow" in merged, false, "the window describes the event only");
  assert.equal(merged.transcriptLength, 4);
});

test("an unloaded transcript keeps only metadata, and a gap asks for a reload", () => {
  const event = session([message("u9", "user", "latest")], { status: "running", transcriptLength: 9, transcriptWindow: { from: 8, total: 9 } });
  const unloaded = mergeSessionEvent(session([]), event, false);
  assert.equal(unloaded.reload, false);
  assert.deepEqual(unloaded.session.messages, [], "partial text is never kept for an unloaded transcript");
  assert.equal(unloaded.session.status, "running");

  const short = mergeSessionEvent(session([message("u1", "user", "only")]), event, true);
  assert.equal(short.reload, true);
  assert.deepEqual(short.session.messages.map(item => item.id), ["u1"], "the held copy is kept until the reload arrives");

  const inconsistent = mergeSessionEvent(session([message("u1", "user", "a"), message("a1", "agent", "b")]), session([message("x", "user", "c")], { transcriptWindow: { from: 1, total: 5 } }), true);
  assert.equal(inconsistent.reload, true);
});

test("a full session from a command replaces the transcript and keeps pins", () => {
  const held = session([message("u1", "user", "q")], { pinnedMessageIds: ["kept"] });
  const { session: merged, reload } = mergeSessionEvent(held, session([message("u1", "user", "q"), message("a1", "agent", "r")], { pinnedMessageIds: ["stale"] }), true);
  assert.equal(reload, false);
  assert.equal(merged.messages.length, 2);
  assert.deepEqual(merged.pinnedMessageIds, ["kept"]);
});

test("the cache keeps selected, active, queued, retained and the most recent transcripts", () => {
  const sessions = ["a", "b", "c", "d", "e"].map((id, index) => session([], { id, status: index === 3 ? "waiting" : "completed" }));
  const keep = transcriptsToKeep({ loaded: { a: 1, b: 2, c: 3, d: 4, e: 5 }, sessions, selectedSessionId: "a", queued: ["b"], retained: ["c"], limit: 1 });
  assert.deepEqual([...keep].sort(), ["a", "b", "c", "d", "e"]);
  const lean = transcriptsToKeep({ loaded: { a: 1, b: 2, e: 5 }, sessions: sessions.map(item => ({ ...item, status: "completed" })), selectedSessionId: null, queued: [], retained: [], limit: 1 });
  assert.deepEqual([...lean], ["e"]);
  // Under memory pressure (limit 0) only transcripts in use stay.
  const pressed = transcriptsToKeep({ loaded: { a: 1, b: 2, e: 5 }, sessions: sessions.map(item => ({ ...item, status: "completed" })), selectedSessionId: "a", queued: [], retained: [], limit: 0 });
  assert.deepEqual([...pressed], ["a"]);
});

test("the size estimate counts text, activity outputs and diffs, cached per message", () => {
  const plain = message("a", "agent", "x".repeat(1000));
  assert.equal(estimateMessageBytes(plain), 64 + 2000);
  const busy: Message = { ...plain, activity: { provider: "codex", model: null, startedAt: 0, endedAt: 1, waitingSince: null, pausedMs: 0, status: "completed", truncated: false,
    items: [{ id: "c", kind: "command", label: "ls", state: "completed", model: null, detail: "ls -la", output: "y".repeat(5000) }],
    review: { files: [{ path: "a.ts", kind: "modified", additions: 1, deletions: 0, binary: false, diff: "z".repeat(3000) }], partial: false, sharedWorkspace: false, keptAt: null, expired: false } } } as Message;
  assert.ok(estimateMessageBytes(busy) > 2 * (1000 + 5000 + 3000));
  assert.equal(estimateTranscriptBytes([plain, busy]), estimateMessageBytes(plain) + estimateMessageBytes(busy));
  // Cached by identity: the same object is not walked again.
  assert.equal(estimateMessageBytes(plain), estimateMessageBytes(plain));
});

test("recent transcripts stay within the byte budget, newest first, never the in-use ones evicted", () => {
  const big = (id: string, chars: number) => session([message(`${id}-m`, "agent", "x".repeat(chars))], { id });
  // Each about 1 000 bytes (500 UTF-16 chars) plus overhead.
  const sessions = [big("a", 500), big("b", 500), big("c", 500), big("d", 500), big("huge", 5000)];
  const loaded = { a: 1, b: 2, c: 3, d: 4, huge: 5 };
  const base = { loaded, sessions, queued: [], retained: [], limit: 8 };
  // Room for two recent ones: the over-budget one is skipped, the next newest stay, the oldest goes.
  const keep = transcriptsToKeep({ ...base, selectedSessionId: null, budget: 2200 });
  assert.deepEqual([...keep].sort(), ["c", "d"]);
  // The selected transcript always stays, even over budget, and its bytes count first.
  const selected = transcriptsToKeep({ ...base, selectedSessionId: "huge", budget: 2200 });
  assert.deepEqual([...selected].sort(), ["huge"]);
  // A large enough budget keeps the count limit as before.
  assert.deepEqual([...transcriptsToKeep({ ...base, selectedSessionId: null, limit: 2 })].sort(), ["d", "huge"]);
});

test("a loaded snapshot never drops text that already streamed past it", () => {
  const held = [message("u", "user", "q"), message("a", "agent", "streamed beyond")];
  const snapshot = [message("u", "user", "q"), message("a", "agent", "streamed")];
  const merged = mergeLoadedTranscript(held, snapshot);
  assert.equal(merged[1].content, "streamed beyond");
  assert.equal(mergeLoadedTranscript(held, [message("u", "user", "q"), message("a", "agent", "rewritten")])[1].content, "rewritten");
  assert.equal(mergeLoadedTranscript([], snapshot), snapshot);
});

test("an unloaded transcript still counts as a started conversation", () => {
  assert.equal(hasConversation(session([], { transcriptLength: 3 })), true);
  assert.equal(hasConversation(session([message("x", "system", "warning")])), false);
});

test("a live event without a command's output keeps the output already held", () => {
  const activity = (items: NonNullable<Message["activity"]>["items"]): NonNullable<Message["activity"]> => ({ provider: "codex", model: null, startedAt: 1, endedAt: null, waitingSince: null, pausedMs: 0, status: "running", items, truncated: false });
  const command = (id: string, output?: string) => ({ id, kind: "command" as const, label: "Command", state: "completed" as const, model: null, ...(output === undefined ? {} : { output }) });
  const held = session([message("u", "user", "go"), { ...message("a", "agent", "working"), activity: activity([command("c1", "built"), command("c2", "line 1")]) }]);
  const event = session([message("u", "user", "go"), { ...message("a", "agent", "working more"), activity: activity([command("c1"), command("c2", "line 1\nline 2"), command("c3")]) }], { status: "running", transcriptLength: 2, transcriptWindow: { from: 0, total: 2 } });
  const { session: merged } = mergeSessionEvent(held, event, true);
  assert.deepEqual(merged.messages[1].activity?.items.map(item => item.output), ["built", "line 1\nline 2", undefined]);
  // Messages without omitted outputs pass through untouched.
  const plain = [message("u", "user", "go")];
  assert.equal(keepSentOutputs(held.messages, plain)[0], plain[0]);
});
