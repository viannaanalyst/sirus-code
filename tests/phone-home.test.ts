import { test } from "node:test";
import assert from "node:assert/strict";
import type { HostInfo, Project } from "../src/client/types.ts";
import { activeHomeFilter, contextMenuTop, createLongPress, filterHomeSessions, hapticTick, middleTruncate, rowDetails, rowMenuItems, searchProjects, shortProjectPath } from "../src/lib/phone-home.ts";
import { fillParams, hostFeatures, hostKind, hostLabel, hostWording } from "../src/lib/phone-host.ts";
import { checkClone, cloneParent, folderPathLooksValid } from "../src/lib/phone-projects.ts";

function clock() {
  let now = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  let next = 1;
  return {
    setTimer: (run: () => void, ms: number) => { const id = next++; timers.set(id, { at: now + ms, run }); return id; },
    clearTimer: (id: unknown) => { timers.delete(id as number); },
    advance: (ms: number) => {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.run(); }
    },
  };
}

test("A long press fires after the delay unless the finger moves past the slop", () => {
  const time = clock();
  let fired = 0;
  const press = createLongPress(() => { fired += 1; }, time);
  press.start(10, 10);
  time.advance(449);
  assert.equal(fired, 0);
  press.move(14, 13);
  time.advance(1);
  assert.equal(fired, 1);
  assert.equal(press.end(), true);
  press.start(10, 10);
  press.move(10, 25);
  time.advance(600);
  assert.equal(fired, 1);
  assert.equal(press.end(), false);
  press.start(0, 0);
  assert.equal(press.end(), false);
  time.advance(600);
  assert.equal(fired, 1, "a lifted finger cancels");
});

test("Haptics are a no-op where vibrate is missing or refused", () => {
  const calls: number[] = [];
  hapticTick({ vibrate: (pattern) => { calls.push(pattern); return true; } });
  hapticTick({});
  hapticTick({ vibrate: () => { throw new Error("blocked"); } });
  assert.deepEqual(calls, [10]);
});

test("The row menu follows its order and the row's place", () => {
  const ids = (input: Parameters<typeof rowMenuItems>[0]) => rowMenuItems(input).map((item) => item.id);
  const home = { place: "home" as const, pinned: false, active: false, order: "updated_at" as const };
  assert.deepEqual(ids(home), ["copy-id", "arrange", "pin", "rename", "delete"]);
  assert.deepEqual(ids({ ...home, place: "snoozed", pinned: true }), ["copy-id", "return", "rename", "delete"]);
  assert.deepEqual(ids({ ...home, place: "list", pinned: true }), ["copy-id", "unpin", "rename", "delete"]);
  const active = rowMenuItems({ ...home, active: true, order: "created_at" });
  assert.equal(active.find((item) => item.id === "delete")?.disabled, true);
  assert.equal(active.find((item) => item.id === "delete")?.destructive, true);
  assert.deepEqual(active.find((item) => item.id === "arrange")?.submenu, [{ id: "updated_at", checked: false }, { id: "created_at", checked: true }]);
});

test("The menu opens under the row, flips above near the bottom, and stays on screen", () => {
  assert.deepEqual(contextMenuTop({ top: 100, bottom: 160 }, 300, 800), { top: 168, above: false });
  assert.deepEqual(contextMenuTop({ top: 600, bottom: 660 }, 300, 800), { top: 292, above: true });
  const squeezed = contextMenuTop({ top: 200, bottom: 400 }, 380, 600);
  assert.equal(squeezed.top >= 12 && squeezed.top + 380 <= 600 - 12 || squeezed.top === 12, true);
});

test("Project picker paths and search", () => {
  assert.equal(shortProjectPath("/Users/gabriel/Projetos/app"), "~/Projetos/app");
  assert.equal(shortProjectPath("/home/ubuntu/projects/app"), "~/projects/app");
  const long = shortProjectPath("/srv/" + "a".repeat(30) + "/" + "b".repeat(30), 20);
  assert.equal(long.length, 20);
  assert.ok(long.includes("…"));
  const project = (name: string, path: string) => ({ id: name, name, path }) as Project;
  const list = [project("Sirus Code", "/x/sirus-code"), project("Site", "/x/web"), project("API", "/x/api")];
  assert.deepEqual(searchProjects(list, " si ").map((item) => item.id), ["Sirus Code", "Site"]);
  assert.deepEqual(searchProjects(list, "x web").map((item) => item.id), ["Site"]);
  assert.equal(searchProjects(list, "").length, 3);
});

const host = (capabilities?: HostInfo["capabilities"], hostName?: string) => ({ capabilities, hostName }) as HostInfo;
const server = { platform: "linux", headless: true, browser: false, computerUse: false, dictation: false, pickers: false };
const mac = { platform: "macos", headless: false, browser: true, computerUse: true, dictation: true, pickers: true };

test("The phone never calls a server a Mac", () => {
  assert.equal(hostKind(null), "mac");
  assert.equal(hostKind(host()), "mac");
  assert.equal(hostKind(host(mac)), "mac");
  assert.equal(hostKind(host(server)), "server");
  assert.equal(hostWording("Reconnecting to the Mac…", "server", "en"), "Reconnecting to the server…");
  assert.equal(hostWording("Mac settings", "server", "en"), "Server settings");
  assert.equal(hostWording("It runs on the Mac. The Mac keeps it.", "server", "en"), "It runs on the server. The server keeps it.");
  assert.equal(hostWording("These change the Mac's own settings", "server", "en"), "These change the server's own settings");
  assert.equal(hostWording("No Mac, ative o HTTPS. O Mac mantém.", "server", "pt-BR"), "No servidor, ative o HTTPS. O servidor mantém.");
  assert.equal(hostWording("Ajustes do Mac", "server", "pt-BR"), "Ajustes do servidor");
  assert.equal(hostWording("Mac", "server", "pt-BR"), "Servidor");
  assert.equal(hostWording("my MacBook and macOS", "server", "en"), "my MacBook and macOS");
  assert.equal(hostWording("Runs on the Mac.", "mac", "en"), "Runs on the Mac.");
  assert.equal(fillParams(hostWording("Switch to {name} on the Mac", "server", "en"), { name: "Mac-fix" }), "Switch to Mac-fix on the server");
  assert.equal(hostLabel(host(server, "vps-1"), "en"), "vps-1");
  assert.equal(hostLabel(host(server, " "), "pt-BR"), "Servidor");
  assert.equal(hostLabel(host(mac, "Gabriels-MacBook"), "en"), "Mac");
});

test("Features follow the host's capabilities; older hosts are the Mac app", () => {
  assert.deepEqual(hostFeatures(null), { browser: true, computerUse: true, dictation: true, pickers: true, devices: true, openInEditor: true });
  assert.deepEqual(hostFeatures(host(server)), { browser: false, computerUse: false, dictation: false, pickers: false, devices: false, openInEditor: false });
  assert.deepEqual(hostFeatures(host({ ...mac, platform: "linux", browser: false, computerUse: false, dictation: false })), { browser: false, computerUse: false, dictation: false, pickers: true, devices: false, openInEditor: true });
});

test("Phone clones accept owner/repo or a GitHub address, strictly", () => {
  assert.deepEqual(checkClone("viannaanalyst/sirus-code"), { ok: true, source: "viannaanalyst/sirus-code", folder: null, name: "sirus-code" });
  assert.deepEqual(checkClone(" https://github.com/a/b.git/ ", " my-b "), { ok: true, source: "a/b", folder: "my-b", name: "my-b" });
  assert.deepEqual(checkClone("github.com/a/b"), { ok: true, source: "a/b", folder: null, name: "b" });
  assert.deepEqual(checkClone(""), { ok: false, reason: "empty" });
  for (const bad of ["a", "a/b/c", "../b", "a/..", "-x/y", "http://github.com/a/b", "https://gitlab.com/a/b", "file:///etc/x", "a b/c", "ext::sh/x"]) {
    assert.deepEqual(checkClone(bad), { ok: false, reason: "repository" }, bad);
  }
  for (const bad of ["a/b", "..", "-x", "with space", "x".repeat(65)]) {
    assert.deepEqual(checkClone("a/b", bad), { ok: false, reason: "folder" }, bad);
  }
  assert.equal(cloneParent("mac"), "~/Projetos");
  assert.equal(cloneParent("server"), "~/projects");
});

test("Typed folder paths must be absolute or start at home", () => {
  for (const ok of ["/srv/app", "~", "~/code/app", " /x "]) assert.equal(folderPathLooksValid(ok), true, ok);
  for (const bad of ["", "app", "./app", "~other/x", "/srv/../etc", "/a\nb"]) assert.equal(folderPathLooksValid(bad), false, bad);
});

test("Long text is shortened in the middle, keeping both ends", () => {
  assert.equal(middleTruncate("main", 10), "main");
  assert.equal(middleTruncate("feature/long-branch-name", 11), "featu…-name");
  assert.equal(middleTruncate("feature/long-branch-name", 11).length, 11);
  assert.equal(middleTruncate("abc", 1), "…");
});

test("A Home row's second line: project, branch, pull request, then the computer when there are several", () => {
  assert.deepEqual(rowDetails({ projectName: "sirus", branch: "main", pullRequest: 42, computer: true }), [
    { kind: "project", text: "sirus" },
    { kind: "branch", text: "main", full: "main" },
    { kind: "pullRequest", text: "#42" },
    { kind: "computer" },
  ]);
  // Unknown or detached branch, no pull request and one computer: only the project.
  assert.deepEqual(rowDetails({ projectName: "sirus", branch: "HEAD", pullRequest: null }), [{ kind: "project", text: "sirus" }]);
  assert.deepEqual(rowDetails({ projectName: " ", branch: "" }), []);
  const long = rowDetails({ branch: "codex/a-very-long-branch-name-for-rows" }, 16)[0];
  assert.deepEqual(long, { kind: "branch", text: "codex/a-…or-rows", full: "codex/a-very-long-branch-name-for-rows" });
});

test("Home's filter ignores projects and computers it no longer knows", () => {
  const known = { projectIds: ["p1", "p2"], environmentIds: ["home", "vps"], multipleComputers: true };
  assert.deepEqual(activeHomeFilter({ projectId: "p1", environmentId: "vps" }, known), { projectId: "p1", environmentId: "vps" });
  assert.deepEqual(activeHomeFilter({ projectId: "gone", environmentId: "gone" }, known), { projectId: null, environmentId: null });
  // A computer filter means nothing with a single computer.
  assert.deepEqual(activeHomeFilter({ environmentId: "vps" }, { ...known, multipleComputers: false }), { projectId: null, environmentId: null });
  assert.deepEqual(activeHomeFilter({}, known), { projectId: null, environmentId: null });
});

test("Home's filter keeps one project's or one computer's conversations", () => {
  const sessions = [{ id: "a", projectId: "p1" }, { id: "b", projectId: "p2" }, { id: "c", projectId: "p1" }];
  const environmentOf = new Map([["c", "vps"]]);
  const ids = (filter: { projectId: string | null; environmentId: string | null }) => filterHomeSessions(sessions, filter, environmentOf, "home").map((item) => item.id);
  assert.deepEqual(ids({ projectId: null, environmentId: null }), ["a", "b", "c"]);
  assert.deepEqual(ids({ projectId: "p1", environmentId: null }), ["a", "c"]);
  // Conversations without an entry are on the store's computer.
  assert.deepEqual(ids({ projectId: null, environmentId: "home" }), ["a", "b"]);
  assert.deepEqual(ids({ projectId: "p1", environmentId: "vps" }), ["c"]);
});
