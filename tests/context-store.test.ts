import { test } from "node:test";
import assert from "node:assert/strict";
import { client } from "../src/client/index.ts";
import { useAppStore } from "../src/store/app-store.ts";
import type { Project, Session } from "../src/client/types.ts";
const projects: Project[] = [{ id: "p", name: "Project", path: "/fixture", addedAt: "time", lastOpenedAt: "time" }];
const session = (id: string): Session => ({ id, title: id, projectId: "p", agent: "codex", status: "idle", createdAt: "time", lastActivityAt: "time", messages: [], lastError: null, worktree: { path: "/fixture", branch: "main", isolated: false } });
function setup() { useAppStore.setState({ projects, sessions: [session("s"), session("other")], selectedProjectId: "p", selectedSessionId: "s", contextTexts: {}, contextTextStatus: {} }); }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

test("reference autosave stays owner scoped during selection and coalesces flushes", async context => {
  setup(); const first = deferred(); const writes: [string, string, boolean][] = [];
  context.mock.method(client, "saveContextText", async (key: string, value: string, flush = false) => { writes.push([key, value, flush]); if (writes.length === 1) await first.promise; });
  const pending = useAppStore.getState().setContextText("session:s", "old");
  useAppStore.setState({ selectedSessionId: "other" });
  const next = useAppStore.getState().setContextText("session:s", "new");
  const flush = useAppStore.getState().flushContextText("session:s");
  first.resolve(); await Promise.all([pending, next, flush]);
  assert.deepEqual(writes, [["session:s", "old", false], ["session:s", "new", true]]);
  assert.equal(useAppStore.getState().contextTexts["session:s"], "new");
  assert.equal(useAppStore.getState().contextTexts["session:other"], undefined);
  assert.equal(useAppStore.getState().selectedSessionId, "other");
  assert.equal(useAppStore.getState().contextTextStatus["session:s"].saving, false);
  assert.deepEqual(useAppStore.getState().sessions.map(row => row.messages), [[], []]);
});

test("failed reference saves retain text and retry clears only the captured owner's error", async context => {
  setup(); let failed = true;
  context.mock.method(client, "saveContextText", async () => { if (failed) throw new Error("disk full"); });
  await useAppStore.getState().setContextText("project:p", "Keep this text");
  assert.equal(useAppStore.getState().contextTexts["project:p"], "Keep this text");
  assert.match(useAppStore.getState().contextTextStatus["project:p"].error!, /disk full/);
  failed = false; await useAppStore.getState().flushContextText("project:p");
  assert.deepEqual(useAppStore.getState().contextTextStatus["project:p"], { saving: false, error: null });
  await useAppStore.getState().setContextText("project:p", "");
  assert.equal(useAppStore.getState().contextTexts["project:p"], undefined);
});

test("deleted sessions cancel queued reference edits without reviving text or stale errors", async context => {
  setup(); const wait = deferred(); let writes = 0;
  context.mock.method(client, "saveContextText", async () => { writes++; await wait.promise; throw new Error("removed owner"); });
  context.mock.method(client, "deleteSession", async () => {});
  const pending = useAppStore.getState().setContextText("session:s", "first");
  const later = useAppStore.getState().setContextText("session:s", "last");
  useAppStore.setState({ selectedSessionId: "other", contextTexts: { ...useAppStore.getState().contextTexts, "project:p": "shared" } });
  context.mock.method(client, "gitStatus", async () => { throw new Error("unused probe"); });
  await useAppStore.getState().deleteSession("s", false);
  wait.resolve(); await Promise.all([pending, later]);
  await useAppStore.getState().flushContextText("session:s");
  assert.equal(writes, 1);
  assert.equal(useAppStore.getState().contextTexts["session:s"], undefined);
  assert.equal(useAppStore.getState().contextTextStatus["session:s"], undefined);
  assert.equal(useAppStore.getState().contextTexts["project:p"], "shared");
});

test("removing a project prunes its notes and instructions and refuses late edits", async context => {
  setup();
  const otherProject = { ...projects[0], id: "kept" };
  useAppStore.setState({ projects: [...projects, otherProject], contextTexts: { "project:p": "instructions", "session:s": "notes", "session:other": "other notes", "project:kept": "retain" } });
  context.mock.method(client, "removeProject", async () => {});
  const save = context.mock.method(client, "saveContextText", async () => {});
  await useAppStore.getState().removeProject("p");
  await useAppStore.getState().setContextText("session:s", "late");
  await useAppStore.getState().flushContextText("project:p");
  assert.deepEqual(useAppStore.getState().contextTexts, { "project:kept": "retain" });
  assert.equal(save.mock.callCount(), 0);
});

test("oversized and foreign edits never replace owner text or reach the native save", async context => {
  setup(); useAppStore.setState({ contextTexts: { "session:s": "retain" } });
  const save = context.mock.method(client, "saveContextText", async () => {});
  await useAppStore.getState().setContextText("session:s", "🙂".repeat(8193));
  await useAppStore.getState().setContextText("project:missing", "foreign");
  assert.equal(useAppStore.getState().contextTexts["session:s"], "retain");
  assert.equal(useAppStore.getState().contextTexts["project:missing"], undefined);
  assert.match(useAppStore.getState().contextTextStatus["session:s"].error!, /16,384/);
  assert.equal(save.mock.callCount(), 0);
});
