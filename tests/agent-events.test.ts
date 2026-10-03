import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAgentOutput } from "../src/lib/agent-events.ts";
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
