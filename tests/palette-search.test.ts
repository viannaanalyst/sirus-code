import { test } from "node:test";
import assert from "node:assert/strict";
import { messageMatches, rankChats, titleRank } from "../src/lib/palette-search.ts";
import type { Session } from "../src/client/types.ts";

const chat = (id: string, title: string, lastActivityAt: string, contents: string[] = []): Session => ({
  id, projectId: "project", title, lastActivityAt, status: "completed",
  messages: contents.map((content, index) => ({ id: `${id}-${index}`, sessionId: id, role: "agent", content })),
} as Session);

test("palette titles rank the whole title, then its start, a word start, anywhere and every word", () => {
  assert.equal(titleRank("Login", "login"), 0);
  assert.equal(titleRank("Login form", "login"), 1);
  assert.equal(titleRank("Fix login form", "login"), 2);
  assert.equal(titleRank("Relogin flow", "login"), 3);
  assert.equal(titleRank("Form for login", "login form"), 4);
  assert.equal(titleRank("Settings", "login"), null);
  const ranked = rankChats([chat("old", "Relogin", "2026-01-01"), chat("new", "Relogin", "2026-02-01"), chat("exact", "Login", "2025-01-01")], "login", 10);
  assert.deepEqual(ranked.map(session => session.id), ["exact", "new", "old"]);
});

test("palette message hits give one row per chat, newest chat first, skipping chats listed by title", () => {
  const sessions = [
    chat("a", "A", "2026-01-01", ["the webhook fires", "webhook again"]),
    chat("b", "B", "2026-03-01", ["no match here"]),
    chat("c", "C", "2026-02-01", ["a webhook"]),
    chat("d", "Webhook chat", "2026-04-01", ["webhook"]),
  ];
  const found = messageMatches(sessions, "webhook", new Set(["d"]), 10);
  assert.deepEqual(found.map(entry => [entry.session.id, entry.hit.messageId, entry.count]), [["c", "c-0", 1], ["a", "a-1", 2]]);
  assert.equal(messageMatches(sessions, "webhook", new Set(), 1).length, 1);
});
