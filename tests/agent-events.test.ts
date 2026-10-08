import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAgentOutput, reuseMessages } from "../src/lib/agent-events.ts";
import type { AgentEvent, Message } from "../src/client/types.ts";
const message = (id: string, role: Message["role"], content: string): Message => ({ id, sessionId: "session", role, content, createdAt: "time", streaming: true });
const event = (id: string, offset: number, chunk: string, snapshot: Message | null = null): AgentEvent => ({ sessionId: "session", messageId: id, offset, chunk, stream: "stdout", message: snapshot });
test("stderr identity and deltas remain separate from assistant prose", () => {
  let messages = [message("assistant", "agent", "Reply")];
  messages = applyAgentOutput(messages, { ...event("diagnostics", 0, "Warning", message("diagnostics", "system", "Warning")), stream: "stderr" });
  messages = applyAgentOutput(messages, event("assistant", 5, " done"));
  assert.deepEqual(messages.map(({ role, content }) => ({ role, content })), [{ role: "agent", content: "Reply done" }, { role: "system", content: "Warning" }]);
});
test("duplicate chunks and older snapshots cannot duplicate output", () => {
  const messages = [message("assistant", "agent", "first second")];
  assert.equal(applyAgentOutput(messages, event("assistant", 5, " second")), messages);
  assert.equal(applyAgentOutput(messages, event("assistant", 0, "first", message("assistant", "agent", "first"))), messages);
});
test("offsets count UTF-16 units consistently for Unicode output", () => {
  const messages = applyAgentOutput([message("assistant", "agent", "🚂")], event("assistant", 2, " ação"));
  assert.equal(messages[0].content, "🚂 ação");
});

test("a replayed first chunk cannot reopen a finished message", () => {
  const finished = { ...message("assistant", "agent", "done"), streaming: false };
  const first = { ...finished, streaming: true };
  assert.deepEqual(applyAgentOutput([finished], { sessionId: "s", messageId: finished.id, message: first, offset: 0, stream: "stdout", chunk: "done" }), [finished]);
});

test("first text snapshot preserves a newer native activity snapshot", () => {
  const activity = { provider: "codex" as const, model: "m", startedAt: 0, endedAt: null, waitingSince: 1, pausedMs: 0, status: "waiting" as const, items: [], truncated: false };
  const current = { ...message("assistant", "agent", ""), activity };
  const first = { ...message("assistant", "agent", "answer"), activity: { ...activity, waitingSince: null, status: "running" as const } };
  const result = applyAgentOutput([current], event("assistant", 0, "answer", first));
  assert.equal(result[0].content, "answer"); assert.equal(result[0].activity, activity);
});

test("a native snapshot keeps unchanged message objects so memoized rows skip rendering", () => {
  const previous = [message("u", "user", "Question"), message("a", "agent", "Answer")];
  const snapshot = previous.map(item => JSON.parse(JSON.stringify(item)) as Message);
  assert.equal(reuseMessages(previous, snapshot), previous, "an identical snapshot keeps the array");
  const grown = [...snapshot.slice(0, 1), { ...snapshot[1], content: "Answer, longer", streaming: false }];
  const merged = reuseMessages(previous, grown);
  assert.equal(merged[0], previous[0]);
  assert.notEqual(merged[1], previous[1]);
  assert.equal(merged[1].content, "Answer, longer");
  const settled = reuseMessages(previous, [snapshot[0], { ...snapshot[1], activity: { provider: "codex" } as unknown as Message["activity"] }]);
  assert.notEqual(settled[1], previous[1], "metadata changes replace the object");
  assert.deepEqual(reuseMessages(previous, [snapshot[1]]).map(item => item.id), ["a"]);
});

test("message comparison sees nested activity, attachment and list changes without serializing", () => {
  const item = { id: "i", kind: "command", label: "npm test", state: "running", model: null, steps: [{ id: "s", kind: "read", label: "a", state: "running" }] };
  const activity = { provider: "codex", model: "m", startedAt: 0, endedAt: null, waitingSince: null, pausedMs: 0, status: "running", items: [item], truncated: false, review: null };
  const base = { ...message("a", "agent", "Answer"), activity, attachments: [{ id: "f", name: "a.png", kind: "file", thumbnail: "data:image/jpeg;base64,AAAA" }], launched: ["x"] } as unknown as Message;
  const copy = () => JSON.parse(JSON.stringify(base)) as Message & { activity: typeof activity };
  const previous = [base];
  assert.equal(reuseMessages(previous, [copy()]), previous, "an equal deep copy keeps the object");
  const changes: ((next: ReturnType<typeof copy>) => void)[] = [
    (next) => { next.activity.items[0].state = "completed"; },
    (next) => { next.activity.items[0].steps[0].state = "completed"; },
    (next) => { next.activity.items.push({ ...item, id: "j" }); },
    (next) => { next.activity.endedAt = 5 as unknown as null; },
    (next) => { next.activity.review = { files: [], partial: false, sharedWorkspace: false, keptAt: null, expired: false } as unknown as null; },
    (next) => { next.attachments![0].name = "b.png"; },
    (next) => { next.attachments!.push({ name: "c.txt", kind: "file" }); },
    (next) => { next.launched = ["y"]; },
    (next) => { next.steers = [{ text: "go", at: "t", offset: 1 }]; },
    (next) => { next.createdAt = "later"; },
  ];
  for (const change of changes) {
    const next = copy();
    change(next);
    assert.notEqual(reuseMessages(previous, [next])[0], base, change.toString());
  }
});
