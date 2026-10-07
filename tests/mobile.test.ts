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
