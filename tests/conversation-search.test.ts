import { test } from "node:test";
import assert from "node:assert/strict";
import { searchConversations, textMatches } from "../src/lib/conversation-search.ts";
import type { Session } from "../src/client/types.ts";

const session = (id: string, content: string, role = "agent"): Session => ({ id, projectId: "project", title: id, messages: [{ id: `${id}-message`, sessionId: id, role, content }], status: "completed" } as Session);
test("conversation search finds literal case-insensitive occurrences, visible code and owned messages only", () => {
  const sessions = [session("a", "Login LOGIN\n```ts\nconst login = true;\n```"), session("b", "login"), session("system", "login", "system")];
  sessions[0].messages.push({ ...sessions[0].messages[0], id: "foreign", sessionId: "b" });
  const result = searchConversations(sessions, "login", "a");
  assert.deepEqual(result.hits.map(hit => [hit.sessionId, hit.messageId, hit.start]), [["a", "a-message", 0], ["a", "a-message", 6], ["a", "a-message", 18]]);
  assert.equal(searchConversations(sessions, "login").hits.length, 4);
  assert.deepEqual(textMatches("a+b A+B abc", "a+b"), [{ start: 0, end: 3 }, { start: 4, end: 7 }]);
  assert.deepEqual(textMatches("área ÁREA", "área"), [{ start: 0, end: 4 }, { start: 5, end: 9 }]);
  assert.equal(searchConversations(sessions, "   ").hits.length, 0);
});
test("search reports additional matches beyond the display bound without manufacturing a total", () => {
  const result = searchConversations([session("a", "login ".repeat(220))], "login");
  assert.equal(result.hits.length, 200);
  assert.equal(result.truncated, true);
  assert.equal(searchConversations([session("a", "login ".repeat(200))], "login").truncated, false);
});
