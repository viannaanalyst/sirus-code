import { test } from "node:test";
import assert from "node:assert/strict";
import type { HostInfo, Project, Session } from "../src/client/types.ts";
import { SwitchingTransport } from "../src/client/switching-transport.ts";
import type { Transport } from "../src/client/transport.ts";
import {
  LAST_TARGET_KEY,
  cloneParentFor,
  mergeComputerProjects,
  computerStatus,
  eventFromThisMac,
  lastTarget,
  moveBranch,
  moveRefusal,
  runsOnThisMac,
  sameGitHubRepo,
} from "../src/lib/computers.ts";
import { HOME_ENVIRONMENT, readEnvironments, upsertEnvironment, writeEnvironments, pairedEnvironment, type Environment, type EnvironmentSummary } from "../src/lib/environments.ts";

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function recorder(name: string, log: string[]): Transport {
  return {
    invoke: async <T>(command: string) => { log.push(`${name}:${command}`); return undefined as T; },
    listen: async (event: string) => { log.push(`${name}:listen:${event}`); return () => { log.push(`${name}:unlisten:${event}`); }; },
  };
}

const session = (id: string, projectId: string, at: string, extra: Partial<Session> = {}) => ({
  id, projectId, title: id, agent: "claude", status: "idle", createdAt: at, lastActivityAt: at,
  worktree: { path: "/p", branch: "main", isolated: false }, messages: [], ...extra,
}) as unknown as Session;
const project = (id: string, at: string) => ({ id, name: id, path: `/p/${id}`, addedAt: at, lastOpenedAt: at }) as unknown as Project;

test("window-bound commands and events stay on this Mac while a server is active", async () => {
  for (const command of ["remote_action", "remote_pair", "start_dictation", "window_ready", "browser_open", "browser_recording_start", "pick_folder", "device_action"]) {
    assert.ok(runsOnThisMac(command), command);
  }
  for (const command of ["load_state", "send_prompt", "pty_write", "git_status", "import_session", "clone_project", "paste_prompt_attachments"]) {
    assert.ok(!runsOnThisMac(command), command);
  }
  assert.ok(eventFromThisMac("remote-changed"));
  assert.ok(!eventFromThisMac("session-updated"));
  assert.ok(!eventFromThisMac("pty-output"));

  const log: string[] = [];
  const local = recorder("mac", log);
  const transport = new SwitchingTransport(local, { transport: local, command: runsOnThisMac, event: eventFromThisMac });
  const unlisten = await transport.listen("session-updated", () => undefined);
  await transport.listen("remote-changed", () => undefined);
  transport.use(recorder("vps", log));
  await transport.invoke("load_state");
  await transport.invoke("remote_action");
  await Promise.resolve();
  unlisten();
  await Promise.resolve();
  // Calls and the moved listener go to the server; this Mac keeps its own command and event.
  assert.deepEqual([...log].sort(), [
    "mac:listen:remote-changed",
    "mac:listen:session-updated",
    "mac:remote_action",
    "mac:unlisten:session-updated",
    "vps:listen:session-updated",
    "vps:load_state",
    "vps:unlisten:session-updated",
  ]);
});

test("the desktop keeps the phone's computer list, with this Mac as home", () => {
  const storage = memory();
  const vps = pairedEnvironment("https://sirus-vps.tail6e87c3.ts.net", "token", { id: "abc", hostName: "sirus-vps", kind: "server" });
  writeEnvironments(storage, upsertEnvironment(readEnvironments(storage, "tauri://localhost"), vps));
  const computers = readEnvironments(storage, "tauri://localhost");
  assert.deepEqual(computers.map((item) => item.id), [HOME_ENVIRONMENT, "host:abc"]);
  assert.equal(computers[1].token, "token");
  // New projects go to the last computer chosen, while it is still paired.
  assert.equal(lastTarget(storage, computers), HOME_ENVIRONMENT);
  storage.setItem(LAST_TARGET_KEY, "host:abc");
  assert.equal(lastTarget(storage, computers), "host:abc");
  assert.equal(lastTarget(storage, [computers[0], { ...computers[1], token: "" }]), HOME_ENVIRONMENT);
  storage.setItem(LAST_TARGET_KEY, "gone");
  assert.equal(lastTarget(storage, computers), HOME_ENVIRONMENT);
});

test("computer status follows the connection; this Mac is always reachable", () => {
  assert.equal(computerStatus("home", "home", undefined), "active");
  assert.equal(computerStatus("home", "host:a", undefined), "online");
  assert.equal(computerStatus("host:a", "home", "open"), "online");
  assert.equal(computerStatus("host:a", "home", "lost"), "offline");
  assert.equal(computerStatus("host:a", "home", "unauthorized"), "unpaired");
  assert.equal(computerStatus("host:a", "home", "connecting"), "connecting");
  assert.equal(computerStatus("host:a", "home", undefined), "connecting");
});

test("the switcher merges other computers' projects by name and lists their conversations", () => {
  const computers: Environment[] = [
    { id: "home", label: "", kind: "mac", baseUrl: "tauri://localhost", token: "", hostName: "" },
    { id: "host:a", label: "", kind: "server", baseUrl: "https://vps.t.ts.net", token: "t", hostName: "vps" },
  ];
  const summary: EnvironmentSummary = {
    sessions: [
      session("s1", "v-shared", "2026-10-11T00:00:00Z"),
      session("s2", "v-shared", "2026-10-12T00:00:00Z"),
      session("s3", "v-only", "2026-10-13T00:00:00Z"),
      session("side", "v-shared", "2026-10-15T00:00:00Z", { sideChat: { parentSessionId: "s1" } as Session["sideChat"] }),
      session("later", "v-shared", "2026-10-16T00:00:00Z", { snoozedUntil: "2099-01-01T00:00:00Z" } as Partial<Session>),
    ],
    projects: [{ ...project("v-shared", "2026-02-01T00:00:00Z"), name: " DP-Inchurch " }, project("v-only", "2026-01-01T00:00:00Z")],
    pinnedSessionIds: [],
    updatedAt: 1,
  };
  const merged = mergeComputerProjects([{ id: "here", name: "dp-inchurch" }], computers, "home", { "host:a": summary }, { "host:a": "lost" }, (item) => item.hostName || "Mac");
  // Same name (case and spaces aside): one row here, with the other computer's conversations, newest first.
  assert.deepEqual(merged.alsoOn.here.map((member) => [member.computerId, member.label, member.status, member.sessions.map((item) => item.id)]), [["host:a", "vps", "offline", ["s2", "s1"]]]);
  assert.deepEqual(merged.elsewhere.map((member) => [member.project.id, member.sessions.map((item) => item.id)]), [["v-only", ["s3"]]]);
  // From the server, this Mac is the other computer; without its summary nothing is listed.
  assert.deepEqual(mergeComputerProjects([], computers, "host:a", {}, {}, () => "Mac"), { alsoOn: {}, elsewhere: [] });
});

test("moving a conversation is planned and refused clearly", () => {
  assert.equal(moveBranch("1A2B3C4D-aaaa-bbbb"), "sirus/move-1a2b3c4d");
  const idle = { status: "idle", sideChat: null } as unknown as Session;
  const base = { session: idle, sourceId: "home", targetId: "host:a", targetConnection: "open", remoteUrl: "https://github.com/o/r" };
  assert.equal(moveRefusal(base), null);
  assert.equal(moveRefusal({ ...base, remoteUrl: undefined }), null);
  // Back to this Mac from a server: this Mac always answers.
  assert.equal(moveRefusal({ ...base, sourceId: "host:a", targetId: "home", targetConnection: undefined }), null);
  assert.equal(moveRefusal({ ...base, targetId: "host:a", sourceId: "host:a" }), "same");
  assert.equal(moveRefusal({ ...base, targetConnection: "lost" }), "offline");
  assert.equal(moveRefusal({ ...base, session: { ...idle, status: "running" } }), "running");
  assert.equal(moveRefusal({ ...base, session: { ...idle, sideChat: { parentSessionId: "x" } } as Session }), "sideChat");
  assert.equal(moveRefusal({ ...base, remoteUrl: null }), "noRemote");
  assert.ok(sameGitHubRepo("https://github.com/Owner/Repo", "https://github.com/owner/repo.git/"));
  assert.ok(!sameGitHubRepo("https://github.com/owner/repo", "https://github.com/owner/other"));
});

test("clones land in the computer's own projects folder", () => {
  const server = { capabilities: { platform: "linux", headless: true, browser: false, computerUse: false, dictation: false, pickers: false } } as HostInfo;
  assert.equal(cloneParentFor(server), "~/projects");
  assert.notEqual(cloneParentFor(null), "~/projects");
});
