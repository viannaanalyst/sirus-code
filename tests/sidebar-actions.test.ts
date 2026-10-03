import { test } from "node:test";
import assert from "node:assert/strict";
import { client } from "../src/client/index.ts";
import { useAppStore } from "../src/store/app-store.ts";
import { defaultSettings } from "../src/lib/settings.ts";
import { sidebarProjectAction } from "../src/lib/sidebar-actions.ts";
import type { CreateSessionRequest, Project, Session } from "../src/client/types.ts";

test("a late terminal session preserves newer navigation and never sends an agent prompt", async (context) => {
  const project: Project = { id: "owner", name: "Fixture", path: "/fixture", addedAt: "time", lastOpenedAt: "time" };
  const session: Session = { id: "terminal", title: "Terminal", projectId: project.id, agent: "codex", status: "idle", createdAt: "time", lastActivityAt: "time", worktree: { path: project.path, branch: "main", isolated: false }, messages: [], lastError: null };
  let resolve!: (session: Session) => void;
  const created = new Promise<Session>((done) => { resolve = done; });
  context.mock.method(client, "openProject", async () => project);
  context.mock.method(client, "createSession", (request: CreateSessionRequest) => {
    assert.equal(request.projectId, project.id);
    assert.equal(request.isolatedWorktree, false);
    return created;
  });
  const send = context.mock.method(client, "sendPrompt", async () => { throw new Error("must not send"); });
  useAppStore.setState({ projects: [project], sessions: [], selectedProjectId: project.id, selectedSessionId: null, mainView: "session", settings: defaultSettings, agents: [{ id: "codex", name: "Codex", binary: "codex", installed: true, path: "/fixture/codex", version: null }], dockOpen: false });
  const action = sidebarProjectAction(project.id, "terminal");
  await new Promise((done) => setImmediate(done));
  useAppStore.setState({ selectedSessionId: "newer-navigation" });
  resolve(session);
  await action;
  assert.equal(useAppStore.getState().selectedSessionId, "newer-navigation");
  assert.equal(useAppStore.getState().dockOpen, false);
  assert.equal(useAppStore.getState().sessions[0], session);
  assert.equal(send.mock.callCount(), 0);
});
