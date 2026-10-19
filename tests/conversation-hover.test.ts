import { test } from "node:test";
import assert from "node:assert/strict";
import type { Message, Session } from "../src/client/types.ts";
import { diffParts, HOVER_GRACE_MS, HOVER_OPEN_MS, HoverCardController, hoverPill, lastReplySnippet, replySnippet, SNIPPET_MAX, workspaceDiff, type HoverTimers } from "../src/lib/conversation-hover.ts";

const message = (role: Message["role"], content: string): Message => ({ id: `${role}-${content.length}`, sessionId: "s", role, content, createdAt: "t", streaming: false } as Message);

test("the pill shows only for working, needing the person or failed", () => {
  assert.equal(hoverPill({ status: "running" }), "working");
  assert.equal(hoverPill({ status: "starting" }), "working");
  assert.equal(hoverPill({ status: "waiting" }), "needsYou");
  assert.equal(hoverPill({ status: "running", pendingRequests: [{}] as Session["pendingRequests"] }), "needsYou");
  assert.equal(hoverPill({ status: "running" }, true), "needsYou", "a computer-use request needs the person too");
  assert.equal(hoverPill({ status: "failed" }), "failed");
  for (const status of ["completed", "idle", "stopped"] as const) assert.equal(hoverPill({ status }), null);
});

test("the snippet is the reply's last paragraph as plain text", () => {
  const reply = "I'll read the code first.\n\n## Summary\n\nThe **sidebar** now shows a [hover card](https://x.dev) with `ConversationRow`.\n- It opens _after_ 450 ms\n";
  assert.equal(replySnippet(reply), "The sidebar now shows a hover card with ConversationRow. It opens after 450 ms");
  assert.equal(replySnippet("Run this:\n\n```sh\nnpm test\n\nnpm run lint\n```\n\n---\n| a | b |\n|---|---|\n"), "a b");
  assert.equal(replySnippet("```rust\nfn main() {}\n```"), null);
  assert.equal(replySnippet("Done.\n\n```\ncode\n```\n"), "Done.");
  assert.equal(replySnippet("> **Note:** see ![diagram](d.png) and <https://sirus.dev>"), "Note: see diagram and https://sirus.dev");
  assert.equal(replySnippet("Renamed `last_reply` in my_module and 2 * 3 * 4 still holds."), "Renamed last_reply in my_module and 2 * 3 * 4 still holds.");
});

test("the snippet masks credentials and stays short", () => {
  const token = `ghp_${"a1B2c3D4e5".repeat(4)}`;
  assert.ok(!replySnippet(`Use ${token} to push.`)!.includes(token));
  const clipped = replySnippet("word ".repeat(200))!;
  assert.ok(Array.from(clipped).length <= SNIPPET_MAX);
  assert.ok(clipped.endsWith("word…"));
  // A long reply is read from its end; a window that starts inside a code block knows it.
  const long = `Intro.\n\n\`\`\`\n${"let x = 1;\n".repeat(1000)}\`\`\`\n\nAll checks pass.`;
  assert.equal(replySnippet(long), "All checks pass.");
  assert.equal(replySnippet(`Intro.\n\n\`\`\`\n${"code line\n".repeat(1000)}`), null);
});

test("a loaded transcript wins over the native preview, else the preview shows", () => {
  const messages = [message("user", "Fix it"), message("agent", "Fixed the bug."), message("user", "Now test"), message("agent", "")];
  assert.equal(lastReplySnippet({ messages, lastReplyPreview: "older" }), "Fixed the bug.");
  assert.equal(lastReplySnippet({ messages: [], lastReplyPreview: "From the metadata" }), "From the metadata");
  assert.equal(lastReplySnippet({ messages: [], lastReplyPreview: "  " }), null);
  assert.equal(lastReplySnippet({ messages: [message("user", "Hi")] }), null);
});

test("lines changed show only for the selected conversation's own worktree", () => {
  const changes = [{ additions: 10, deletions: 2 }, { additions: 3, deletions: 0 }];
  const own = { id: "a", worktree: { path: "/w", branch: "sirus/a", isolated: true } };
  assert.deepEqual(workspaceDiff(own, { sessionId: "a", changes }), { additions: 13, deletions: 2 });
  assert.equal(workspaceDiff(own, { sessionId: "b", changes }), null, "another conversation's status is not this one's");
  assert.equal(workspaceDiff({ ...own, worktree: { ...own.worktree, isolated: false } }, { sessionId: "a", changes }), null, "a shared checkout's lines are the project's");
  assert.deepEqual(diffParts({ additions: 13, deletions: 2 }), { added: "+13", removed: "−2" });
  assert.equal(diffParts({ additions: 0, deletions: 0 }), null);
  assert.equal(diffParts(null), null);
});

function fakeTimers() {
  let now = 0, next = 1;
  const pending = new Map<number, { at: number; run: () => void }>();
  const timers: HoverTimers = {
    set: (run, ms) => { pending.set(next, { at: now + ms, run }); return next++; },
    clear: (id) => { pending.delete(id); },
    now: () => now,
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at > now) continue;
      pending.delete(id);
      timer.run();
    }
  };
  return { timers, advance };
}

test("the card waits on the first row, then follows the pointer at once and closes after a grace", () => {
  const { timers, advance } = fakeTimers();
  const card = new HoverCardController<{ id: string }>(timers);
  const a = { id: "a" }, b = { id: "b" };
  card.enter(a);
  advance(HOVER_OPEN_MS - 1);
  assert.equal(card.current(), null);
  advance(1);
  assert.equal(card.current(), a);
  // Moving to the next row: no closing in between, no wait.
  card.leave("a");
  card.enter(b);
  assert.equal(card.current(), b);
  advance(HOVER_GRACE_MS);
  assert.equal(card.current(), b);
  card.leave("b");
  advance(HOVER_GRACE_MS);
  assert.equal(card.current(), null);
  // Just after closing, the next row's card opens at once; later it waits again.
  card.enter(a);
  assert.equal(card.current(), a);
  card.dismiss();
  advance(1000);
  card.enter(b);
  assert.equal(card.current(), null);
});

test("a pass over a row, a click or an open menu keeps the card away", () => {
  const { timers, advance } = fakeTimers();
  const card = new HoverCardController<{ id: string }>(timers);
  card.enter({ id: "a" });
  card.leave("a");
  advance(HOVER_OPEN_MS);
  assert.equal(card.current(), null, "passing over a row opens nothing");
  card.enter({ id: "a" });
  advance(HOVER_OPEN_MS);
  card.dismiss("a");
  card.enter({ id: "a" });
  advance(HOVER_OPEN_MS);
  assert.equal(card.current(), null, "a clicked row stays closed while the pointer is on it");
  card.leave("a");
  advance(1000);
  card.block(true);
  card.enter({ id: "b" });
  advance(HOVER_OPEN_MS);
  assert.equal(card.current(), null, "nothing opens while a context menu is open");
  card.block(false);
  card.enter({ id: "a" });
  advance(HOVER_OPEN_MS);
  assert.deepEqual(card.current(), { id: "a" });
});
