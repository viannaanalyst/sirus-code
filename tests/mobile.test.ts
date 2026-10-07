import { test } from "node:test";
import assert from "node:assert/strict";
import type { PendingRequest, Project, Session } from "../src/client/types.ts";
import { homeSections, listedSessions, needsYou, projectGroups, sessionBadge, shortAgo } from "../src/lib/mobile.ts";

function session(id: string, fields: Partial<Session> = {}): Session {
  return {
    id, title: `Session ${id}`, projectId: "p1", agent: "codex", status: "idle", createdAt: "2026-10-07T10:00:00Z",
    lastActivityAt: "2026-10-07T10:00:00Z", worktree: { path: "/w", branch: "main", isolated: false }, messages: [], lastError: null, ...fields,
  };
}
const project = (id: string, name: string, lastOpenedAt = "2026-10-01T00:00:00Z"): Project => ({ id, name, path: `/${id}`, addedAt: lastOpenedAt, lastOpenedAt });
const request = (type: "command" | "userInput"): PendingRequest => ({ requestId: "r", generation: "g", turnId: "t", itemId: "i",
  kind: type === "command" ? { type: "command", command: "ls", cwd: null, reason: null } : { type: "userInput", questions: [] } });

test("Home puts what needs the person first, then running work, then the rest by recency", () => {
  const sessions = [
    session("old", { lastActivityAt: "2026-10-06T10:00:00Z", status: "completed" }),
    session("run", { status: "running", lastActivityAt: "2026-10-07T09:00:00Z" }),
    session("ask", { status: "running", pendingRequests: [request("command")] }),
    session("wait", { status: "waiting", lastActivityAt: "2026-10-07T11:00:00Z" }),
    session("new", { lastActivityAt: "2026-10-07T12:00:00Z", status: "completed" }),
  ];
  const sections = homeSections(sessions, [project("p1", "dp-inchurch")], "");
  assert.deepEqual(sections.needsYou.map((item) => item.id), ["wait", "ask"]);
  assert.deepEqual(sections.working.map((item) => item.id), ["run"]);
  assert.deepEqual(sections.recent.map((item) => item.id), ["new", "old"]);
  assert.deepEqual(homeSections(sessions, [project("p1", "dp-inchurch")], "INCHURCH").recent.length, 2, "project names match");
  assert.deepEqual(homeSections(sessions, [], "Session wait").needsYou.map((item) => item.id), ["wait"]);
});

test("Badges name what the agent waits for", () => {
  assert.equal(sessionBadge(session("a", { pendingRequests: [request("userInput")] })), "question");
  assert.equal(sessionBadge(session("b", { pendingRequests: [request("command")] })), "approve");
  assert.equal(sessionBadge(session("c", { status: "starting" })), "working");
  assert.equal(sessionBadge(session("d", { status: "failed" })), "failed");
  assert.equal(sessionBadge(session("e", { status: "completed" })), null);
  assert.equal(needsYou(session("f", { status: "waiting" })), true);
});

test("Lists hide side chats, Astro chats and archived sessions", () => {
  const sessions = [session("a"), session("b", { sideChat: { parentSessionId: "a" } }), session("c", { astro: "x" }), session("d")];
  assert.deepEqual(listedSessions(sessions, ["d"]).map((item) => item.id), ["a"]);
});

test("Projects sort by their latest conversation and count what needs attention", () => {
  const groups = projectGroups([project("p1", "one"), project("p2", "two", "2026-10-05T00:00:00Z")], [
    session("a", { projectId: "p1", lastActivityAt: "2026-10-07T12:00:00Z", status: "waiting" }),
    session("b", { projectId: "p1", status: "running" }),
  ]);
  assert.deepEqual(groups.map((group) => group.project.id), ["p1", "p2"]);
  assert.equal(groups[0].needsYou, 1);
  assert.equal(groups[0].working, 1);
  assert.equal(groups[1].sessions.length, 0);
});

test("Relative time is short and localized", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  assert.equal(shortAgo("2026-10-07T11:59:40Z", "pt-BR", now), "agora");
  assert.equal(shortAgo("2026-10-07T11:56:00Z", "en", now), "4 min");
  assert.equal(shortAgo("2026-10-07T09:00:00Z", "en", now), "3 h");
  assert.equal(shortAgo("2026-10-04T12:00:00Z", "en", now), "3 d");
  assert.equal(shortAgo("nope", "en", now), "");
});

test("Phone dictation keeps final phrases and shows the one still being heard", async () => {
  const { joinTranscript } = await import("../src/lib/web-dictation.ts");
  const result = (text: string, isFinal: boolean) => ({ isFinal, 0: { transcript: text } });
  assert.deepEqual(joinTranscript([result("Corrija o deploy ", true), result(" da Vercel", true), result("agora", false)]), { final: "Corrija o deploy da Vercel", interim: "agora" });
  assert.deepEqual(joinTranscript([]), { final: "", interim: "" });
});

test("The keyboard counts as open only when it takes a real share of the screen", async () => {
  const { keyboardOpen } = await import("../src/lib/mobile-viewport.ts");
  assert.equal(keyboardOpen(852, 852), false);
  assert.equal(keyboardOpen(852, 780), false, "toolbars and rounding are not a keyboard");
  assert.equal(keyboardOpen(852, 520), true);
});

test("New conversation and New Astro rise as sheets; the rest slide in", async () => {
  const { isSheet } = await import("../src/lib/mobile.ts");
  assert.equal(isSheet({ kind: "new", projectId: null }), true);
  assert.equal(isSheet({ kind: "new-astro" }), true);
  assert.equal(isSheet({ kind: "chat", sessionId: "s" }), false);
});

test("Phone dictation restarts short sessions and works again the second time", async () => {
  const { WebDictation } = await import("../src/lib/web-dictation.ts");
  const made: FakeRecognition[] = [];
  class FakeRecognition {
    lang = ""; continuous = true; interimResults = false;
    onresult: ((event: unknown) => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    constructor() { made.push(this); }
    start() {}
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
    say(text: string) { this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] }); }
  }
  (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
  const dictation = new WebDictation();
  await dictation.start("pt-BR", () => undefined);
  assert.equal(made[0].continuous, false, "short sessions, not iPhone's flaky continuous mode");
  made[0].say("corrija o deploy");
  made[0].onend?.(); // the recognizer paused on its own; a new session starts
  assert.equal(made.length, 2);
  made[1].say("da Vercel");
  assert.equal(await dictation.stop(false), "corrija o deploy da Vercel");
  await dictation.start("pt-BR", () => undefined);
  made[2].say("segunda vez");
  assert.equal(await dictation.stop(false), "segunda vez");
  delete (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

test("Coming back reloads only when the Mac serves a newer build", async () => {
  const { isNewerBuild } = await import("../src/lib/remote-resume.ts");
  assert.equal(isNewerBuild('<script src="/assets/index-abc.js"></script>', "/assets/index-abc.js"), false);
  assert.equal(isNewerBuild('<script src="/assets/index-def.js"></script>', "/assets/index-abc.js"), true);
});

test("Phone photos are scaled to fit 2048 px and never enlarged", async () => {
  const { fittedSize } = await import("../src/lib/phone-attachments.ts");
  assert.deepEqual(fittedSize(4032, 3024), { width: 2048, height: 1536 });
  assert.deepEqual(fittedSize(3024, 4032), { width: 1536, height: 2048 });
  assert.deepEqual(fittedSize(800, 600), { width: 800, height: 600 });
});

test("Messages written offline wait in order and stop at the first that fails", async () => {
  const { enqueueMessage, flushOutbox, readOutbox } = await import("../src/lib/phone-outbox.ts");
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
  enqueueMessage({ sessionId: "a", prompt: "primeira" }, storage);
  enqueueMessage({ sessionId: "a", prompt: "segunda" }, storage);
  enqueueMessage({ sessionId: "b", prompt: "terceira" }, storage);
  const sent: string[] = [];
  assert.equal(await flushOutbox(async (message) => { sent.push(message.prompt); return message.prompt !== "segunda"; }, storage), 1);
  assert.deepEqual(sent, ["primeira", "segunda"]);
  assert.deepEqual(readOutbox(storage).map((item) => item.prompt), ["segunda", "terceira"]);
  storage.setItem("sirus.outbox", "not json");
  assert.deepEqual(readOutbox(storage), []);
});

test("A swiped row opens past half its actions and pinned conversations group together", async () => {
  const { homeSections, sortEntries, swipeRest } = await import("../src/lib/mobile.ts");
  assert.equal(swipeRest(-100, 222), 0);
  assert.equal(swipeRest(-130, 222), -222);
  const sessions = [session("a", { status: "completed" }), session("b", { status: "completed" }), session("c", { status: "waiting" })];
  const sections = homeSections(sessions, [], "", ["b", "c"]);
  assert.deepEqual(sections.pinned.map((item) => item.id), ["b"]);
  assert.deepEqual(sections.needsYou.map((item) => item.id), ["c"], "needing the person beats pinning");
  assert.deepEqual(sections.recent.map((item) => item.id), ["a"]);
  assert.deepEqual(sortEntries([{ name: "b.ts", path: "/b.ts", isDir: false }, { name: "src", path: "/src", isDir: true }, { name: "a10.md", path: "/a10.md", isDir: false }, { name: "a2.md", path: "/a2.md", isDir: false }]).map((item) => item.name), ["src", "a2.md", "a10.md", "b.ts"]);
});
