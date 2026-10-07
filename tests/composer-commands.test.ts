import { test } from "node:test";
import assert from "node:assert/strict";
import { availableCommands, commandPosition, conversationMarkdown, filterCommands } from "../src/lib/composer-commands.ts";
import type { Message } from "../src/client/types.ts";

const message = (role: Message["role"], content: string, streaming = false): Message => ({ id: content, sessionId: "s", role, content, createdAt: "t", streaming });

test("commands follow the composer's situation", () => {
  const ids = (list: { id: string }[]) => list.map((command) => command.id);
  assert.deepEqual(ids(availableCommands({ session: null, agent: "codex", fastAvailable: false })), ["review"]);
  const settled = { status: "completed" as const, sideChat: null, messages: [message("user", "hi"), message("agent", "ok")] };
  assert.deepEqual(ids(availableCommands({ session: settled, agent: "codex", fastAvailable: true })), ["review", "compact", "status", "mcp", "fast", "rename", "fork", "export", "side", "new"]);
  const running = { ...settled, status: "running" as const };
  assert.ok(!ids(availableCommands({ session: running, agent: "opencode", fastAvailable: false })).some((id) => id === "fork" || id === "compact" || id === "fast"));
  const side = { ...settled, sideChat: { parentSessionId: "p" } };
  assert.ok(!ids(availableCommands({ session: side, agent: "claude", fastAvailable: false })).some((id) => id === "side" || id === "fork" || id === "new"));
});

test("matching prefers prefixes and commands only lead the message", () => {
  const all = availableCommands({ session: { status: "completed", sideChat: null, messages: [message("agent", "ok")] }, agent: "claude", fastAvailable: true });
  assert.deepEqual(filterCommands(all, "re").map((command) => command.id), ["review", "rename"]);
  assert.deepEqual(filterCommands(all, "or").map((command) => command.id), ["fork", "export"]);
  assert.ok(commandPosition("  /re", 2) && !commandPosition("please /re", 7));
});

test("exports keep user and assistant text only", () => {
  const markdown = conversationMarkdown({ title: "Fix login", agent: "codex", model: "gpt", createdAt: "2026-10-05T10:00:00Z" }, [message("user", "Fix it"), message("system", "stderr"), message("agent", "Done.")], { you: "You", agent: "Agent" });
  assert.equal(markdown, "# Fix login\n\ncodex · gpt · 2026-10-05\n\n## You\n\nFix it\n\n## Agent\n\nDone.\n");
});
