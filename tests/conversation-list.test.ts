import assert from "node:assert/strict";
import { test } from "node:test";
import type { Project, Session } from "../src/client/types.ts";
import { mergeSettings } from "../src/lib/settings.ts";
import { clampConversationListWidth, conversationListItems, conversationSortKeys, itemOffsets, listedConversations, offsetWindow, CONVERSATION_LIST_MAX_WIDTH, CONVERSATION_LIST_MIN_WIDTH, type ConversationListItem } from "../src/lib/conversation-list.ts";

const project = (id: string): Project => ({ id, name: id, path: `/fixture/${id}`, addedAt: "time", lastOpenedAt: "time" });
const projects = [project("a"), project("b")];
const session = (id: string, projectId: string, lastActivityAt: string, extra: Partial<Session> = {}): Session => ({ id, title: id, projectId, agent: "codex", status: "completed", createdAt: "2026-01-01", lastActivityAt, worktree: { path: "/fixture", branch: "main", isolated: false }, messages: [], lastError: null, ...extra });
const keys = (items: readonly ConversationListItem[]) => items.map(item => item.kind === "project" ? `#${item.project.id}` : item.session.id);

const sessions = [
  session("a-old", "a", "2026-01-02"),
  session("b-new", "b", "2026-01-09"),
  session("a-mid", "a", "2026-01-05"),
  session("b-old", "b", "2026-01-01"),
];

test("settings: sidebar mode and list order are closed, default to the rail and Recent, and keep sidebarCollapsed", () => {
  const legacy = mergeSettings({ sidebarCollapsed: true });
  assert.equal(legacy.sidebarMode, "rail");
  assert.equal(legacy.sidebarListOrder, "recent");
  assert.equal(legacy.sidebarCollapsed, true);
  assert.equal(mergeSettings({ sidebarMode: "list", sidebarListOrder: "project" }).sidebarMode, "list");
  assert.equal(mergeSettings({ sidebarMode: "list", sidebarListOrder: "project" }).sidebarListOrder, "project");
  assert.equal(mergeSettings({ sidebarMode: "hidden", sidebarListOrder: "name" } as never).sidebarMode, "rail");
  assert.equal(mergeSettings({ sidebarMode: "hidden", sidebarListOrder: "name" } as never).sidebarListOrder, "recent");
});

test("the list leaves out archived, snoozed, side chats, Ask conversations, foreign projects and listed team workers", () => {
  const rows = [
    ...sessions,
    session("archived", "a", "2026-01-08"),
    session("snoozed", "a", "2026-01-08", { snoozedUntil: "2999-01-01T00:00:00Z" }),
    session("side", "a", "2026-01-08", { sideChat: { parentSessionId: "a-old" } }),
    session("ask", "a", "2026-01-08", { pullAsk: { repository: "o/r", number: 1, kind: "pull", title: "t", url: "https://github.com/o/r/pull/1" } } as unknown as Partial<Session>),
    session("foreign", "gone", "2026-01-08"),
    session("worker", "a", "2026-01-08", { teamWorker: { coordinatorSessionId: "a-mid" } } as Partial<Session>),
    session("orphan-worker", "a", "2026-01-08", { teamWorker: { coordinatorSessionId: "deleted" } } as Partial<Session>),
  ];
  const settings = mergeSettings({ archivedSessionIds: ["archived"] });
  assert.deepEqual(listedConversations(projects, rows, settings).map(row => row.id).sort(), ["a-mid", "a-old", "b-new", "b-old", "orphan-worker"]);
});

test("Recent is flat by last activity whatever the thread order, with pinned conversations first in pin order", () => {
  const settings = mergeSettings({ sidebarThreadSortOrder: "created_at" });
  assert.deepEqual(keys(conversationListItems(projects, sessions, settings, "recent")), ["b-new", "a-mid", "a-old", "b-old"]);
  const pinned = mergeSettings({ pinnedSessionIds: ["b-old", "a-old"] });
  const items = conversationListItems(projects, sessions, pinned, "recent");
  assert.deepEqual(keys(items), ["b-old", "a-old", "b-new", "a-mid"]);
  assert.deepEqual(items.map(item => item.kind === "session" && item.pinned), [true, true, false, false]);
});

test("By project groups under a header per project, ordered by each project's latest unpinned conversation", () => {
  const settings = mergeSettings({});
  assert.deepEqual(keys(conversationListItems(projects, sessions, settings, "project")), ["#b", "b-new", "b-old", "#a", "a-mid", "a-old"]);
  // A pin floats inside its project but does not drag the project up.
  const pinned = mergeSettings({ pinnedSessionIds: ["a-old"] });
  const items = conversationListItems(projects, [...sessions, session("a-oldest", "a", "2025-12-01")], pinned, "project");
  assert.deepEqual(keys(items), ["#b", "b-new", "b-old", "#a", "a-old", "a-mid", "a-oldest"]);
  const header = items.find(item => item.kind === "project" && item.project.id === "a");
  assert.equal(header?.kind === "project" && header.count, 3);
  assert.deepEqual(keys(conversationListItems(projects, [], settings, "project")), []);
});

test("working and unread first applies to the list, and a held snapshot keeps rows still", () => {
  const settings = mergeSettings({ sidebarAttentionFirst: true });
  const rows = [...sessions, session("running", "a", "2025-12-01", { status: "running" })];
  assert.deepEqual(keys(conversationListItems(projects, rows, settings, "recent", { unseen: new Set(["b-old"]) })), ["running", "b-old", "b-new", "a-mid", "a-old"]);
  // While held, a conversation that just moved keeps its captured place.
  const held = conversationSortKeys(rows, settings);
  const moved = rows.map(row => row.id === "a-old" ? { ...row, lastActivityAt: "2026-02-01" } : row);
  assert.deepEqual(keys(conversationListItems(projects, moved, settings, "recent", { held })), ["running", "b-new", "a-mid", "a-old", "b-old"]);
  assert.deepEqual(keys(conversationListItems(projects, moved, settings, "recent")), ["running", "a-old", "b-new", "a-mid", "b-old"]);
});

test("item offsets and the viewport window handle two row heights", () => {
  const offsets = itemOffsets(["project", "session", "session", "project", "session"], 60, 30);
  assert.deepEqual(offsets, [0, 30, 90, 150, 180, 240]);
  assert.deepEqual(offsetWindow(offsets, 0, 100, 0), { start: 0, end: 3 });
  assert.deepEqual(offsetWindow(offsets, 95, 60, 0), { start: 2, end: 4 });
  assert.deepEqual(offsetWindow(offsets, 1000, 100, 0), { start: 4, end: 5 });
  assert.deepEqual(offsetWindow(offsets, 0, 100, 12), { start: 0, end: 5 });
  assert.deepEqual(offsetWindow([0], 0, 100), { start: 0, end: 0 });
  // A long list mounts only the rows near the viewport.
  const long = itemOffsets(Array.from({ length: 1000 }, () => "session" as const), 64, 30);
  const range = offsetWindow(long, 64 * 500, 640);
  assert.ok(range.start === 488 && range.end === 523, JSON.stringify(range));
});

test("the column width stays within its bounds", () => {
  assert.equal(clampConversationListWidth(100), CONVERSATION_LIST_MIN_WIDTH);
  assert.equal(clampConversationListWidth(9000), CONVERSATION_LIST_MAX_WIDTH);
  assert.equal(clampConversationListWidth(300.4), 300);
});
