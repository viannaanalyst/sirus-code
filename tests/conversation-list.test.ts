import assert from "node:assert/strict";
import { test } from "node:test";
import type { Project, Session } from "../src/client/types.ts";
import { mergeSettings } from "../src/lib/settings.ts";
import { clampConversationListWidth, conversationListItems, conversationSortKeys, conversationTimeGroup, expandOpenFolder, folderStatus, isColumnSidebar, itemOffsets, listedConversations, offsetWindow, openFolderIds, projectConversationItems, projectStripOrder, toggleOpenFolder, CONVERSATION_LIST_MAX_WIDTH, FOLDER_PREVIEW, CONVERSATION_LIST_MIN_WIDTH, SIDEBAR_OPEN_FOLDERS_LIMIT, type ConversationListItem } from "../src/lib/conversation-list.ts";

const project = (id: string): Project => ({ id, name: id, path: `/fixture/${id}`, addedAt: "time", lastOpenedAt: "time" });
const projects = [project("a"), project("b")];
const session = (id: string, projectId: string, lastActivityAt: string, extra: Partial<Session> = {}): Session => ({ id, title: id, projectId, agent: "codex", status: "completed", createdAt: "2026-01-01", lastActivityAt, worktree: { path: "/fixture", branch: "main", isolated: false }, messages: [], lastError: null, ...extra });
const keys = (items: readonly ConversationListItem[]) => items.map(item => item.kind === "folder" ? `${item.open ? "v" : ">"}${item.project.id}` : item.kind === "time" ? `@${item.group}` : item.kind === "more" ? `+${item.hidden}` : item.session.id);
const open = (...ids: string[]) => ({ openFolders: new Set(ids) });

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
  assert.equal(legacy.sidebarOpenFolders, null);
  assert.equal(legacy.sidebarCollapsed, true);
  assert.equal(mergeSettings({ sidebarMode: "project" }).sidebarMode, "project");
  assert.deepEqual(mergeSettings({ sidebarOpenFolders: [] }).sidebarOpenFolders, []);
  assert.deepEqual(mergeSettings({ sidebarOpenFolders: ["a", "a", "", "x".repeat(65), "b"] }).sidebarOpenFolders, ["a", "b"]);
  assert.equal(mergeSettings({ sidebarOpenFolders: Array.from({ length: 150 }, (_, index) => `p${index}`) }).sidebarOpenFolders?.length, 100);
  assert.ok(isColumnSidebar("list") && isColumnSidebar("project") && !isColumnSidebar("rail"));
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

test("By project is folders only, ordered by each project's latest unpinned conversation; open ones list theirs, nested", () => {
  const settings = mergeSettings({});
  assert.deepEqual(keys(conversationListItems(projects, sessions, settings, "project")), [">b", ">a"]);
  assert.deepEqual(keys(conversationListItems(projects, sessions, settings, "project", open("b", "a"))), ["vb", "b-new", "b-old", "va", "a-mid", "a-old"]);
  // A pin floats inside its project but does not drag the project up.
  const pinned = mergeSettings({ pinnedSessionIds: ["a-old"] });
  const items = conversationListItems(projects, [...sessions, session("a-oldest", "a", "2025-12-01")], pinned, "project", open("a"));
  assert.deepEqual(keys(items), [">b", "va", "a-old", "a-mid", "a-oldest"]);
  const folder = items.find(item => item.kind === "folder" && item.project.id === "a");
  assert.equal(folder?.kind === "folder" && folder.count, 3);
  assert.ok(items.every(item => item.kind !== "session" || item.nested));
  assert.ok(conversationListItems(projects, sessions, settings, "recent").every(item => item.kind === "session" && !item.nested));
  assert.deepEqual(keys(conversationListItems(projects, [], settings, "project")), []);
});

test("an open folder shows its first conversations and Show more; full, all of them and Show less; the selected one always shows", () => {
  const settings = mergeSettings({});
  const many = Array.from({ length: FOLDER_PREVIEW + 3 }, (_, index) => session(`a${index}`, "a", `2026-02-${String(20 - index).padStart(2, "0")}`));
  const preview = conversationListItems(projects, many, settings, "project", open("a"));
  assert.deepEqual(keys(preview), ["va", ...many.slice(0, FOLDER_PREVIEW).map(row => row.id), "+3"]);
  const kept = conversationListItems(projects, many, settings, "project", { ...open("a"), keep: "a7" });
  assert.deepEqual(keys(kept), ["va", ...many.slice(0, FOLDER_PREVIEW).map(row => row.id), "a7", "+2"]);
  const full = conversationListItems(projects, many, settings, "project", { ...open("a"), fullFolders: new Set(["a"]) });
  assert.deepEqual(keys(full), ["va", ...many.map(row => row.id), "+0"]);
  assert.deepEqual(keys(conversationListItems(projects, many.slice(0, FOLDER_PREVIEW), settings, "project", open("a"))).at(-1), many[FOLDER_PREVIEW - 1].id);
});

test("a folder's dot is its most urgent conversation: working, then waiting, then unread", () => {
  const unseen = new Set(["done"]);
  const done = session("done", "a", "2026-01-01");
  const waiting = session("waiting", "a", "2026-01-01", { status: "waiting" });
  const running = session("running", "a", "2026-01-01", { status: "running" });
  assert.equal(folderStatus([done, waiting, running], unseen), "running");
  assert.equal(folderStatus([done, waiting], unseen), "waiting");
  assert.equal(folderStatus([done], unseen), "done");
  assert.equal(folderStatus([session("idle", "a", "2026-01-01")], unseen), "idle");
  assert.equal(folderStatus([session("asks", "a", "2026-01-01")], new Set(), new Set(["asks"])), "waiting");
  const items = conversationListItems(projects, [...sessions, waiting], mergeSettings({}), "project", { unseen: new Set(["b-old"]) });
  assert.deepEqual(items.map(item => item.kind === "folder" ? item.status : null), ["done", "waiting"]);
});

test("open folders: the selected project's until one is toggled, then the saved list, bounded", () => {
  assert.deepEqual(openFolderIds(null, "a"), ["a"]);
  assert.deepEqual(openFolderIds(null, null), []);
  assert.deepEqual(openFolderIds([], "a"), [], "every folder closed stays closed");
  assert.deepEqual(openFolderIds(["b"], "a"), ["b"]);
  assert.deepEqual(toggleOpenFolder(["a"], "a"), []);
  assert.deepEqual(toggleOpenFolder(["a"], "b"), ["b", "a"]);
  const full = Array.from({ length: SIDEBAR_OPEN_FOLDERS_LIMIT }, (_, index) => `p${index}`);
  const next = toggleOpenFolder(full, "new");
  assert.equal(next.length, SIDEBAR_OPEN_FOLDERS_LIMIT);
  assert.equal(next[0], "new");
  // Selecting a conversation opens its folder; an open one changes nothing.
  assert.deepEqual(expandOpenFolder(["b"], "a"), ["a", "b"]);
  assert.equal(expandOpenFolder(["a", "b"], "a"), null);
});

test("time groups: Today since local midnight, This week the 7 days before, the rest Older", () => {
  const now = new Date(2026, 9, 18, 15, 0).getTime();
  assert.equal(conversationTimeGroup(new Date(2026, 9, 18, 0, 5).getTime(), now), "today");
  assert.equal(conversationTimeGroup(new Date(2026, 9, 17, 23, 55).getTime(), now), "week");
  assert.equal(conversationTimeGroup(now - 6 * 86_400_000, now), "week");
  assert.equal(conversationTimeGroup(now - 8 * 86_400_000, now), "older");
  assert.equal(conversationTimeGroup(Number.NaN, now), "older");
});

test("the Project style lists one project's conversations under Pinned, Today, This week and Older", () => {
  const now = new Date(2026, 9, 18, 15, 0).getTime();
  const at = (days: number) => new Date(now - days * 86_400_000).toISOString();
  const rows = [
    session("today", "a", at(0.01)),
    session("old", "a", at(40)),
    session("week", "a", at(3)),
    session("pinned", "a", at(60)),
    session("other", "b", at(0.01)),
  ];
  const settings = mergeSettings({ pinnedSessionIds: ["pinned"] });
  const items = projectConversationItems(projects, rows, settings, "a", now);
  assert.deepEqual(keys(items), ["@pinned", "pinned", "@today", "today", "@week", "week", "@older", "old"]);
  assert.deepEqual(keys(projectConversationItems(projects, rows, mergeSettings({}), "b", now)), ["@today", "other"]);
  assert.deepEqual(projectConversationItems(projects, rows, settings, "gone", now), []);
  assert.deepEqual(projectConversationItems(projects, rows, settings, null, now), []);
  // While held, a row keeps the group it was in when the pointer arrived.
  const held = conversationSortKeys(rows, settings);
  const moved = rows.map(row => row.id === "old" ? { ...row, lastActivityAt: at(0) } : row);
  assert.deepEqual(keys(projectConversationItems(projects, moved, settings, "a", now, { held })), keys(items));
  assert.deepEqual(keys(projectConversationItems(projects, moved, settings, "a", now)), ["@pinned", "pinned", "@today", "old", "today", "@week", "week"]);
});

test("the project strip follows the switcher: pinned first, then the manual order or newest", () => {
  const rows = [project("a"), project("b"), project("c")].map((row, index) => ({ ...row, addedAt: `2026-01-0${index + 1}` }));
  const ids = (list: readonly { id: string }[]) => list.map(row => row.id);
  assert.deepEqual(ids(projectStripOrder(rows, { pinnedProjectIds: [], sidebarProjectOrder: [], sidebarProjectSortOrder: "manual" })), ["a", "b", "c"]);
  assert.deepEqual(ids(projectStripOrder(rows, { pinnedProjectIds: ["c"], sidebarProjectOrder: ["b", "a"], sidebarProjectSortOrder: "manual" })), ["c", "b", "a"]);
  assert.deepEqual(ids(projectStripOrder(rows, { pinnedProjectIds: [], sidebarProjectOrder: [], sidebarProjectSortOrder: "created_at" })), ["c", "b", "a"]);
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
  const offsets = itemOffsets(["folder", "session", "session", "time", "session"], 60, 30);
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
