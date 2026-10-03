import assert from "node:assert/strict";
import { test } from "node:test";
import { hasContextOwner, normalizeContextTexts, pinnedContextMessages, CONTEXT_TEXT_LIMIT } from "../src/lib/context-text.ts";
import { createDraftWriter } from "../src/lib/draft-persistence.ts";
import type { Project, Session } from "../src/client/types.ts";
const projects: Project[] = [{ id: "p", name: "Project", path: "/fixture", addedAt: "time", lastOpenedAt: "time" }];
const session: Session = { id: "s", title: "Task", projectId: "p", agent: "codex", status: "idle", createdAt: "time", lastActivityAt: "time", worktree: { path: "/fixture", branch: "main", isolated: false }, messages: [], lastError: null };

test("local references retain only bounded owned content, including Unicode", () => {
  const data = { "session:s": "🙂".repeat(CONTEXT_TEXT_LIMIT / 2), "project:p": "Conventions", "session:missing": "foreign", "path:/fixture": "path", "project:bad": "x".repeat(CONTEXT_TEXT_LIMIT + 1) };
  const normalized = normalizeContextTexts(data, projects, [session]);
  assert.deepEqual(Object.keys(normalized), ["session:s", "project:p"]);
  assert.ok(hasContextOwner("session:s", projects, [session]));
  assert.ok(!hasContextOwner("session:s", [], [session]));
  assert.deepEqual(normalizeContextTexts(undefined, projects, [session]), {});
  assert.deepEqual(normalizeContextTexts(data, projects, []), { "project:p": "Conventions" });
});

test("the pinned list resolves only real settled assistant messages in saved pin order", () => {
  const message = (id: string) => ({ id, sessionId: "s", role: "agent" as const, content: id, createdAt: "time", streaming: false });
  const data = { ...session, pinnedMessageIds: ["two", "one", "one", "missing", "stream", "foreign", "user"], messages: [message("one"), message("two"), { ...message("stream"), streaming: true }, { ...message("foreign"), sessionId: "other" }, { ...message("user"), role: "user" as const }] };
  assert.deepEqual(pinnedContextMessages(data).map(row => row.id), ["two", "one"]);
});

test("coalesced reference edits retain a blur flush even when newer text arrives", async () => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const writes: { value: string; flush: boolean }[] = [];
  const writer = createDraftWriter(async (_key, edit: { value: string; flush: boolean }) => { writes.push(edit); if (writes.length === 1) await wait; }, () => assert.fail("unexpected save failure"), (previous, next) => ({ ...next, flush: previous.flush || next.flush }));
  const pending = writer.write("session:s", { value: "first", flush: false });
  writer.write("session:s", { value: "blur", flush: true });
  writer.write("session:s", { value: "latest", flush: false });
  release(); await pending;
  assert.deepEqual(writes, [{ value: "first", flush: false }, { value: "latest", flush: true }]);
});
