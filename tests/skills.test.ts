import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentSkill, Session } from "../src/client/types.ts";
import { filterSkills, insertSkillInvocation, skillContextKey, skillSections, toggleSkill } from "../src/lib/skills.ts";
import { mergeSettings } from "../src/lib/settings.ts";

const skills: AgentSkill[] = [
  { name: "review", description: "Review changes", sources: [{ id: "1", origin: "codex", scope: "user", path: "/home/.codex/skills/review/SKILL.md" }, { id: "2", origin: "claude", scope: "user", path: "/home/.claude/skills/review/SKILL.md" }] },
  { name: "local", description: "Workspace tools", sources: [{ id: "3", origin: "pi", scope: "project", path: "/repo/.pi/skills/local/SKILL.md" }] },
];
test("skills search matches all words across metadata and sources and excludes disabled picker entries", () => {
  assert.deepEqual(filterSkills(skills, "REVIEW claude"), [skills[0]]);
  assert.deepEqual(filterSkills(skills, ".pi project"), [skills[1]]);
  assert.deepEqual(filterSkills(skills, "review missing"), []);
  assert.deepEqual(filterSkills(skills, "", ["review"], true), [skills[1]]);
  assert.deepEqual(skillSections(skills).map(([key]) => key), ["project", "shared"]);
});
test("catalog toggles survive legacy settings and do not modify provider preferences or the original", () => {
  const initial = mergeSettings({ disabledProviders: ["grok"] });
  assert.deepEqual(initial.disabledSkills, []);
  const off = toggleSkill(initial, "review", false);
  assert.deepEqual(off.disabledSkills, ["review"]);
  assert.deepEqual(toggleSkill(off, "review", false).disabledSkills, ["review"]);
  assert.deepEqual(toggleSkill(off, "review", true).disabledSkills, []);
  assert.deepEqual(initial.disabledSkills, []);
  assert.deepEqual(off.disabledProviders, ["grok"]);
  assert.deepEqual(mergeSettings({ disabledSkills: ["review", "review", "../outside", "BAD"] }).disabledSkills, ["review"]);
});
test("skill selection adds a leading visible invocation and preserves draft text without duplicating invocations", () => {
  assert.equal(insertSkillInvocation("fix this", "review"), "/review fix this");
  assert.equal(insertSkillInvocation("", "review"), "/review ");
  assert.equal(insertSkillInvocation(" /REVIEW /local fix", "review"), " /REVIEW /local fix");
  assert.equal(insertSkillInvocation("mention /review here", "review"), "/review mention /review here");
});
test("catalog identity changes for provider, profile and workspace but stays stable across activity", () => {
  const session: Session = { id: "s", projectId: "p", title: "Task", agent: "codex", providerAccountId: "private", status: "idle", createdAt: "time", lastActivityAt: "time", worktree: { path: "/repo", branch: "main", isolated: false }, messages: [], lastError: null };
  const state = { sessions: [session], projects: [], settings: mergeSettings({}), selectedProviderAccounts: {} };
  const owner = { sessionId: "s", projectId: "p" };
  const key = skillContextKey(state, owner);
  assert.equal(skillContextKey({ ...state, sessions: [{ ...session, status: "running" }] }, owner), key);
  for (const change of [{ agent: "claude" as const }, { providerAccountId: "other" }, { worktree: { ...session.worktree, path: "/worktree" } }]) {
    assert.notEqual(skillContextKey({ ...state, sessions: [{ ...session, ...change }] }, owner), key);
  }
  const project = { projectId: "p", sessionId: null };
  assert.notEqual(skillContextKey(state, project), skillContextKey({ ...state, selectedProviderAccounts: { codex: "named" } }, project));
  assert.equal(skillContextKey(state, { projectId: null, sessionId: null }), "global");
});
