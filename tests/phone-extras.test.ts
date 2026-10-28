import { test } from "node:test";
import assert from "node:assert/strict";
import type { Message, Session } from "../src/client/types.ts";
import { nextDiffRange } from "../src/lib/diff-comment.ts";
import { needsYouCount, syncAppBadge, workingClock, workingSeconds } from "../src/lib/phone-live.ts";
import { moveQueued, readOutbox, enqueueMessage } from "../src/lib/phone-outbox.ts";
import { hasPromptLink, parsePhonePromptLink, resolveLinkedProject, sanitizeLinkedPrompt, validLinkedModel, withoutPromptLink } from "../src/lib/phone-prompt-link.ts";
import { canMove, moveItem } from "../src/lib/queue-order.ts";
import { phoneSnoozeChoices, snoozePresetTime } from "../src/lib/snooze.ts";
import { translate } from "../src/i18n/index.ts";

function session(id: string, fields: Partial<Session> = {}): Session {
  return {
    id, title: id, projectId: "p1", agent: "codex", status: "idle", createdAt: "2026-10-13T10:00:00Z",
    lastActivityAt: "2026-10-13T10:00:00Z", worktree: { path: "/w", branch: "main", isolated: false }, messages: [], lastError: null, ...fields,
  };
}
const message = (id: string, role: Message["role"], fields: Partial<Message> = {}): Message => ({ id, sessionId: "s", role, content: id, createdAt: "2026-10-13T10:00:00Z", streaming: false, ...fields });

test("the phone's snooze offers this evening only while it is an hour or more away", () => {
  const afternoon = new Date(2026, 9, 13, 14, 20);
  assert.deepEqual(phoneSnoozeChoices(afternoon).map((choice) => choice.preset), ["hour", "evening", "tomorrow", "monday"]);
  assert.equal(snoozePresetTime("evening", afternoon).getTime(), new Date(2026, 9, 13, 18, 0).getTime());
  assert.deepEqual(phoneSnoozeChoices(new Date(2026, 9, 13, 17, 5)).map((choice) => choice.preset), ["hour", "tomorrow", "monday"]);
  for (const locale of ["en", "pt-BR"] as const) assert.notEqual(translate(locale, "snooze.preset.evening"), "snooze.preset.evening");
});

test("the app badge counts what needs the person and stays quiet where unsupported", async () => {
  const sessions = [
    session("a", { status: "waiting" }),
    session("b", { status: "running", pendingRequests: [{ requestId: "r", generation: "g", turnId: "t", itemId: "i", kind: { type: "command", command: "ls", cwd: null, reason: null } }] }),
    session("c", { status: "waiting" }),
    session("d", { status: "waiting", sideChat: { parentSessionId: "a" } }),
    session("e", { status: "completed" }),
  ];
  assert.equal(needsYouCount(sessions), 3);
  const calls: string[] = [];
  const badge = { setAppBadge: async (count?: number) => { calls.push(`set:${count}`); }, clearAppBadge: async () => { calls.push("clear"); } };
  assert.equal(await syncAppBadge(2, badge), true);
  assert.equal(await syncAppBadge(0, badge), true);
  assert.deepEqual(calls, ["set:2", "clear"]);
  assert.equal(await syncAppBadge(3, {}), false);
  assert.equal(await syncAppBadge(3, undefined), false);
  assert.equal(await syncAppBadge(1, { setAppBadge: async () => { throw new Error("denied"); } }), false);
});

test("the working pill counts from the running turn, without the time it waited", () => {
  const activity = { provider: "codex" as const, model: null, startedAt: 1_000_000, endedAt: null, waitingSince: null, pausedMs: 5_000, status: "running" as const, items: [], truncated: false };
  const running = session("r", { status: "running", messages: [message("u", "user"), message("a", "agent", { activity })] });
  const clock = workingClock(running);
  assert.deepEqual(clock, { startedAt: 1_000_000, pausedMs: 5_000 });
  assert.equal(workingSeconds(clock!, 1_047_900), 42);
  assert.equal(workingSeconds(clock!, 900_000), 0);
  // Before the reply has an activity, the person's message starts the clock.
  assert.equal(workingClock(session("s", { status: "starting", messages: [message("u", "user")] }))?.startedAt, Date.parse("2026-10-13T10:00:00Z"));
  // Idle, or waiting on the person: no pill.
  assert.equal(workingClock(session("i", { messages: [message("u", "user")] })), null);
  assert.equal(workingClock(session("w", { status: "waiting", messages: [message("u", "user")] })), null);
});

test("queued requests move one place at a time and never past one that is sending", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(moveItem(items, "c", -1)?.map((item) => item.id), ["a", "c", "b"]);
  assert.deepEqual(moveItem(items, "a", 1)?.map((item) => item.id), ["b", "a", "c"]);
  assert.equal(moveItem(items, "a", -1), null);
  assert.equal(moveItem(items, "c", 1), null);
  assert.equal(moveItem(items, "x", 1), null);
  const sending = (item: { id: string }) => item.id === "a";
  assert.equal(canMove(items, "b", -1, sending), false);
  assert.equal(canMove(items, "a", 1, sending), false);
  assert.equal(canMove(items, "b", 1, sending), true);
  assert.deepEqual(items.map((item) => item.id), ["a", "b", "c"], "the input stays as it was");
});

test("the offline outbox reorders a conversation's messages and leaves the others in place", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
  const first = enqueueMessage({ sessionId: "a", prompt: "one" }, storage);
  enqueueMessage({ sessionId: "b", prompt: "other" }, storage);
  const second = enqueueMessage({ sessionId: "a", prompt: "two" }, storage);
  assert.equal(moveQueued(second.id, -1, storage), true);
  assert.deepEqual(readOutbox(storage).map((item) => item.prompt), ["two", "other", "one"]);
  assert.equal(moveQueued(second.id, -1, storage), false);
  assert.equal(moveQueued(first.id, 1, storage), false);
  assert.equal(moveQueued("missing", 1, storage), false);
});

test("a tap chooses a diff line, a second tap extends it, and a tap on the same line lets go", () => {
  const one = nextDiffRange(null, 4, false, true);
  assert.deepEqual(one, { anchor: 4, from: 4, to: 4 });
  assert.equal(nextDiffRange(one, 4, false, true), null);
  const range = nextDiffRange(one, 1, false, true);
  assert.deepEqual(range, { anchor: 4, from: 1, to: 4 });
  // Once a range is chosen, a tap starts over.
  assert.deepEqual(nextDiffRange(range, 9, false, true), { anchor: 9, from: 9, to: 9 });
  // With a mouse, a click starts over and Shift-click extends, as before.
  assert.deepEqual(nextDiffRange(one, 7, false), { anchor: 7, from: 7, to: 7 });
  assert.deepEqual(nextDiffRange(range, 8, true), { anchor: 4, from: 4, to: 8 });
  assert.equal(translate("pt-BR", "review.commentHintTouch") !== "review.commentHintTouch" && translate("en", "review.commentHintTouch") !== "review.commentHintTouch", true);
});

test("a prompt link in the app's address fills the sheet under the Mac's rules", () => {
  const query = (params: Record<string, string>) => `?${new URLSearchParams(params)}`;
  assert.equal(parsePhonePromptLink("?session=s1"), null);
  assert.equal(hasPromptLink("?session=s1"), false);
  assert.deepEqual(parsePhonePromptLink(query({ prompt: "  Fix the build ", project: "Sirus", provider: "Claude", model: "claude-opus-4-5", session: "s1", utm: "x" })),
    { kind: "open", prompt: "Fix the build", hiddenCharacters: 0, project: "Sirus", provider: "claude", model: "claude-opus-4-5" });
  // Invisible and bidi characters go, and are counted; an emoji's joiner stays.
  const linked = parsePhonePromptLink(query({ prompt: "Ru\u200bn\u202e it\u{E0041} 👩\u200d💻" }));
  assert.deepEqual(linked, { kind: "open", prompt: "Run it 👩\u200d💻", hiddenCharacters: 3, project: null, provider: null, model: null });
  assert.deepEqual(sanitizeLinkedPrompt("a\u2028b\u200dc"), { text: "a\nbc", hidden: 1 });
  assert.deepEqual(parsePhonePromptLink(query({ prompt: "\u200b\u200f" })), { kind: "invalid", reason: "hiddenOnly" });
  assert.deepEqual(parsePhonePromptLink(query({ prompt: " " })), { kind: "invalid", reason: "noPrompt" });
  assert.deepEqual(parsePhonePromptLink(query({ project: "Sirus" })), { kind: "invalid", reason: "noPrompt" });
  assert.deepEqual(parsePhonePromptLink(query({ prompt: "x".repeat(8_001) })), { kind: "invalid", reason: "tooLong" });
  assert.equal(parsePhonePromptLink(query({ prompt: "x".repeat(8_000) }))?.kind, "open");
  assert.deepEqual(parsePhonePromptLink("?prompt=a&prompt=b"), { kind: "invalid", reason: "repeatedParameter" });
  assert.deepEqual(parsePhonePromptLink(query({ prompt: "a", provider: "gpt" })), { kind: "invalid", reason: "provider" });
  assert.deepEqual(parsePhonePromptLink(query({ prompt: "a", model: "gpt-5" })), { kind: "invalid", reason: "model" });
  assert.deepEqual(parsePhonePromptLink(query({ prompt: "a", provider: "codex", model: "--yolo" })), { kind: "invalid", reason: "model" });
  assert.deepEqual(parsePhonePromptLink(query({ prompt: "a", project: "Si\u200brus" })), { kind: "invalid", reason: "project" });
  assert.deepEqual(parsePhonePromptLink(query({ prompt: "a", project: "x".repeat(1_025) })), { kind: "invalid", reason: "project" });
  assert.equal(validLinkedModel("anthropic/claude-sonnet-4.5@latest"), true);
  assert.equal(validLinkedModel("model name"), false);
  assert.equal(withoutPromptLink("?prompt=a&project=b&provider=c&model=d&session=s1"), "?session=s1");
  assert.equal(withoutPromptLink("?prompt=a"), "");
  for (const reason of ["tooLong", "repeatedParameter", "noPrompt", "hiddenOnly", "project", "provider", "model"]) {
    assert.notEqual(translate("pt-BR", `promptLink.reason.${reason}`), `promptLink.reason.${reason}`);
  }
});

test("a linked project matches by id, then name, then path, most recently opened first", () => {
  const projects = [
    { id: "p1", name: "Sirus", path: "/code/sirus", lastOpenedAt: "2026-10-01T00:00:00Z" },
    { id: "p2", name: "sirus", path: "/old/sirus/", lastOpenedAt: "2026-10-10T00:00:00Z" },
  ];
  assert.equal(resolveLinkedProject("p1", projects)?.id, "p1");
  assert.equal(resolveLinkedProject("SIRUS", projects)?.id, "p2");
  assert.equal(resolveLinkedProject("/code/sirus/", projects)?.id, "p1");
  assert.equal(resolveLinkedProject("/old/sirus", projects)?.id, "p2");
  assert.equal(resolveLinkedProject("missing", projects), null);
  assert.equal(resolveLinkedProject(null, projects), null);
});

test("new phone strings exist in both languages", () => {
  for (const key of ["mobile.workingPill", "mobile.outboxUp", "mobile.outboxDown", "queue.moveUp", "queue.moveDown", "snooze.phoneTitle", "snooze.page", "snooze.none", "snooze.change", "snooze.return"]) {
    const en = translate("en", key, { duration: "4s", position: 2 }), pt = translate("pt-BR", key, { duration: "4s", position: 2 });
    assert.notEqual(en, key);
    assert.notEqual(pt, key);
    assert.notEqual(en, pt, key);
  }
});
