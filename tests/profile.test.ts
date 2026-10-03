import assert from "node:assert/strict";
import { test } from "node:test";
import type { Session, Project } from "../src/client/types.ts";
import { buildProfileStats, profileIdentity, normalizeProfile } from "../src/lib/profile-stats.ts";
import { mergeSettings, resetGeneralSettings } from "../src/lib/settings.ts";

const project: Project = { id: "p", name: "Workspace", path: "/fixture", addedAt: "time", lastOpenedAt: "time" };
const session = (id: string, days: string[]): Session => ({ id, projectId: "p", title: id, agent: "codex", model: "gpt", status: "completed", createdAt: "2026-09-01T00:00:00Z", lastActivityAt: "2026-10-02T12:00:00Z", worktree: { path: "/fixture", branch: "main", isolated: false }, lastError: null,
  messages: days.map((day, index) => ({ id: `${id}-${index}`, sessionId: id, role: "user", content: "private", createdAt: `${day}T12:00:00Z`, streaming: false })) });

test("profile counts only retained owned activity and excludes fork copies and imported history", () => {
  const original = session("original", ["2026-09-30", "2026-10-01", "2026-10-02"]);
  const fork = { ...session("fork", ["2026-09-30", "2026-10-01", "2026-10-02"]), forkOrigin: { sourceSessionId: "original", sourceMessageId: "m", sourceTitle: "Original", inheritedMessageCount: 2 } };
  const imported = { ...session("imported", ["2026-10-02"]), importOrigin: { provider: "codex" as const, conversationId: "external" } };
  const foreign = { ...session("foreign", ["2026-10-02"]), projectId: "deleted" };
  const stats = buildProfileStats([project], [original, fork, imported, foreign], new Date("2026-10-02T16:00:00Z"));
  assert.equal(stats.totalPrompts, 4);
  assert.equal(stats.totalSessions, 3);
  assert.equal(stats.currentStreak, 3);
  assert.equal(stats.longestStreak, 3);
  assert.equal(stats.mostWorkedProject?.count, 4);
  assert.equal(stats.heatmap.at(-1)?.count, 2);
  assert.equal(stats.heatmap.length, 274);
});
test("profile uses local calendar days across midnight and does not count future or invalid timestamps", () => {
  const item = session("s", []);
  item.messages = ["2026-10-02T02:00:00Z", "2026-10-02T04:00:00Z", "invalid", "2040-01-01T00:00:00Z"].map((createdAt, i) => ({ id: `${i}`, sessionId: "s", role: "user", content: "", createdAt, streaming: false }));
  const stats = buildProfileStats([project], [item], new Date("2026-10-02T12:00:00Z"));
  assert.equal(stats.totalPrompts, 2);
  assert.equal(stats.heatmap.reduce((sum, cell) => sum + cell.count, 0), 2);
  assert.ok(stats.currentStreak >= 1);
  assert.ok(stats.heatmap.every(cell => cell.intensity >= 0 && cell.intensity <= 4));
});
test("empty profile has no fabricated activity, tokens, providers or plugins", () => {
  const stats = buildProfileStats([], [], new Date("2026-10-02T12:00:00Z"));
  assert.equal(stats.totalPrompts, 0);
  assert.equal(stats.currentStreak, 0);
  assert.equal(stats.longestStreak, 0);
  assert.equal(stats.topProvider, null);
  assert.equal(stats.peakHour, null);
  assert.deepEqual(stats.models, []);
  assert.ok(stats.heatmap.every(cell => cell.count === 0 && cell.intensity === 0));
});
test("provider/model rankings describe current active-session choices rather than historical token shares", () => {
  const stats = buildProfileStats([project], [session("one", ["2026-10-02"]), { ...session("two", ["2026-10-02"]), agent: "claude", model: "sonnet" }, session("empty", [])], new Date("2026-10-02T16:00:00Z"));
  assert.equal(stats.models.length, 2);
  assert.ok(stats.models.every(model => model.percent === 50));
  assert.equal(stats.topProvider?.percent, 50);
});
test("local profile preferences are bounded and remain outside the General reset", () => {
  const profile = normalizeProfile({ name: "  Gabriel Vianna  ", handle: "@@ga!briel", avatarColor: "unknown", avatarImage: "https://example.com/avatar" } as never);
  assert.deepEqual(profile, { name: "Gabriel Vianna", handle: "gabriel", avatarColor: "silver", avatarImage: null });
  const settings = mergeSettings({ profile });
  assert.deepEqual(resetGeneralSettings(settings).profile, profile);
  assert.deepEqual(profileIdentity(profile, "Fallback"), { name: "Gabriel Vianna", handle: "@gabriel", initials: "GV" });
});

test("profile calendar rolls forward and expires a streak after an inactive day", () => {
  const retained = [session("s", ["2026-10-01"])];
  const second = new Date(2026, 9, 2, 12), third = new Date(2026, 9, 3, 12);
  const yesterday = buildProfileStats([project], retained, second, "2026-10-02");
  const expired = buildProfileStats([project], retained, third, "2026-10-03");
  assert.equal(yesterday.currentStreak, 1);
  assert.equal(expired.currentStreak, 0);
  assert.equal(expired.heatmap.at(-1)?.day, "2026-10-03");
  assert.equal(expired.totalPrompts, yesterday.totalPrompts);
});
