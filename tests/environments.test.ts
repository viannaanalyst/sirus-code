import { test } from "node:test";
import assert from "node:assert/strict";
import type { Project, Session } from "../src/client/types.ts";
import { REMOTE_TOKEN_KEY, redeemPairingAt, socketUrlFor } from "../src/client/remote-pairing.ts";
import { SwitchingTransport } from "../src/client/switching-transport.ts";
import type { Transport } from "../src/client/transport.ts";
import {
  ENVIRONMENTS_KEY,
  HOME_ENVIRONMENT,
  SUMMARY_LIMIT,
  applySessionUpdate,
  chooseActive,
  environmentLabel,
  mergeEnvironments,
  normalizeBaseUrl,
  pairedEnvironment,
  readEnvironments,
  readSummaries,
  removeEnvironment,
  renameEnvironment,
  summarize,
  upsertEnvironment,
  writeEnvironments,
  writeSummaries,
} from "../src/lib/environments.ts";
import { enqueueMessage, flushOutbox, readOutbox } from "../src/lib/phone-outbox.ts";
import { homeSections } from "../src/lib/mobile.ts";

function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
    removeItem: (key: string) => { items.delete(key); },
    items,
  };
}

function session(id: string, fields: Partial<Session> = {}): Session {
  return {
    id, title: `Session ${id}`, projectId: "p1", agent: "codex", status: "idle", createdAt: "2026-10-07T10:00:00Z",
    lastActivityAt: "2026-10-07T10:00:00Z", worktree: { path: "/w", branch: "main", isolated: false }, messages: [], lastError: null, ...fields,
  };
}
const project = (id: string, name = id): Project => ({ id, name, path: `/${id}`, addedAt: "2026-10-01T00:00:00Z", lastOpenedAt: "2026-10-01T00:00:00Z" });

const MAC = "https://macbook.tail6e87c3.ts.net";
const VPS = "https://sirus-vps.tail6e87c3.ts.net";

test("typed addresses become origins", () => {
  assert.equal(normalizeBaseUrl("sirus-vps.tail6e87c3.ts.net"), VPS);
  assert.equal(normalizeBaseUrl(" https://sirus-vps.tail6e87c3.ts.net/some/path "), VPS);
  assert.equal(normalizeBaseUrl("http://100.80.1.2:7710"), "http://100.80.1.2:7710");
  for (const refused of ["", "localhost", "ftp://x.ts.net", "https://user:pw@x.ts.net", "not a url"]) assert.equal(normalizeBaseUrl(refused), null, refused);
  assert.equal(socketUrlFor(VPS), "wss://sirus-vps.tail6e87c3.ts.net/api/socket");
  assert.equal(socketUrlFor("http://100.80.1.2:7710"), "ws://100.80.1.2:7710/api/socket");
});

test("the home computer keeps its old token and the list keeps the others", () => {
  const storage = memory({ [REMOTE_TOKEN_KEY]: "home-token" });
  const empty = readEnvironments(storage, MAC);
  assert.deepEqual(empty.map((item) => [item.id, item.baseUrl, item.token]), [[HOME_ENVIRONMENT, MAC, "home-token"]]);

  const vps = pairedEnvironment(VPS, "vps-token", { id: "abc", hostName: "sirus-vps", kind: "server" });
  assert.deepEqual(vps, { id: "host:abc", label: "", kind: "server", baseUrl: VPS, token: "vps-token", hostName: "sirus-vps" });
  let list = upsertEnvironment(empty, vps);
  list = renameEnvironment(list, HOME_ENVIRONMENT, "  MacBook  ");
  writeEnvironments(storage, list);
  // The home token is never copied into the list.
  assert.ok(!storage.getItem(ENVIRONMENTS_KEY)!.includes("home-token"));
  const read = readEnvironments(storage, MAC);
  assert.deepEqual(read.map((item) => [item.id, item.label, item.token]), [[HOME_ENVIRONMENT, "MacBook", "home-token"], ["host:abc", "", "vps-token"]]);

  // Pairing again at the same address replaces the token and keeps the name.
  const renamed = renameEnvironment(read, "host:abc", "Cloud");
  const again = upsertEnvironment(renamed, pairedEnvironment(VPS, "new-token", { id: "abc", kind: "server" }));
  assert.equal(again.length, 2);
  assert.deepEqual([again[1].token, again[1].label], ["new-token", "Cloud"]);

  // Forgetting removes the token; the home computer cannot be forgotten.
  assert.deepEqual(removeEnvironment(again, "host:abc").map((item) => item.id), [HOME_ENVIRONMENT]);
  assert.equal(removeEnvironment(again, HOME_ENVIRONMENT).length, 2);

  // A page opened from the other computer sees it as home, never twice.
  writeEnvironments(storage, again);
  assert.deepEqual(readEnvironments(memory({ [ENVIRONMENTS_KEY]: storage.getItem(ENVIRONMENTS_KEY)! }), VPS).map((item) => item.baseUrl), [VPS]);
  // Unreadable storage only loses the list.
  assert.equal(readEnvironments(memory({ [ENVIRONMENTS_KEY]: "{oops" }), MAC).length, 1);
});

test("the active computer must be known and paired", () => {
  const list = upsertEnvironment(readEnvironments(memory({ [REMOTE_TOKEN_KEY]: "t" }), MAC), pairedEnvironment(VPS, "v", { id: "abc" }));
  assert.equal(chooseActive(list, "host:abc"), "host:abc");
  assert.equal(chooseActive(list, "gone"), HOME_ENVIRONMENT);
  assert.equal(chooseActive(list, null), HOME_ENVIRONMENT);
  assert.equal(chooseActive([{ ...list[0] }, { ...list[1], token: "" }], "host:abc"), HOME_ENVIRONMENT);
});

test("computers are named by the person, else Mac, else the server's name", () => {
  assert.equal(environmentLabel({ label: "", kind: "mac", hostName: "MacBook-Air" }), "Mac");
  assert.equal(environmentLabel({ label: "", kind: "server", hostName: "sirus-vps" }), "sirus-vps");
  assert.equal(environmentLabel({ label: "", kind: "server", hostName: "" }, "Servidor"), "Servidor");
  assert.equal(environmentLabel({ label: " Work ", kind: "mac", hostName: "" }), "Work");
});

test("summaries keep the recent conversations without transcripts and follow updates", () => {
  const many = Array.from({ length: SUMMARY_LIMIT + 5 }, (_, index) => session(`s${index}`, { lastActivityAt: `2026-10-07T10:${String(index % 60).padStart(2, "0")}:00Z`, messages: [{ id: "m" } as never] }));
  const summary = summarize({ sessions: [...many, session("side", { sideChat: { parentSessionId: "s1" } as never })], projects: [project("p1")], pinnedSessionIds: ["s1", "missing"] }, 5);
  assert.equal(summary.sessions.length, SUMMARY_LIMIT);
  assert.ok(summary.sessions.every((item) => item.messages.length === 0 && !item.sideChat));
  assert.ok(!summary.pinnedSessionIds.includes("missing"));
  assert.equal(summary.updatedAt, 5);

  const updated = applySessionUpdate(summary, session(summary.sessions[3].id, { title: "Renamed" }), 9);
  assert.equal(updated.sessions[3].title, "Renamed");
  assert.equal(updated.sessions.length, SUMMARY_LIMIT);
  const added = applySessionUpdate(summary, session("fresh"), 9);
  assert.equal(added.sessions[0].id, "fresh");
  assert.equal(applySessionUpdate(summary, session("side2", { sideChat: { parentSessionId: "x" } as never })), summary);

  const storage = memory();
  writeSummaries(storage, { vps: summary });
  assert.equal(readSummaries(storage).vps.sessions.length, SUMMARY_LIMIT);
  assert.deepEqual(readSummaries(memory({ "sirus.environments.summaries": "[1]" })), {});
});

test("the Home merges every computer, the active one winning, sorted together", () => {
  const merged = mergeEnvironments(
    { id: "home", sessions: [session("a", { lastActivityAt: "2026-10-07T09:00:00Z" }), session("dup", { title: "live" })], projects: [project("p1", "sirus")], pinnedSessionIds: ["a"] },
    [{ id: "vps", sessions: [session("b", { projectId: "p2", lastActivityAt: "2026-10-07T12:00:00Z" }), session("c", { projectId: "p2", status: "waiting" }), session("dup", { title: "stale" })], projects: [project("p2", "api"), project("p1", "dup")], pinnedSessionIds: [] }],
  );
  assert.deepEqual(merged.sessions.map((item) => item.id), ["a", "dup", "b", "c"]);
  assert.equal(merged.sessions.find((item) => item.id === "dup")?.title, "live");
  assert.deepEqual(merged.projects.map((item) => item.id), ["p1", "p2"]);
  assert.equal(merged.environmentOf.get("b"), "vps");
  assert.equal(merged.environmentOf.get("p2"), "vps");
  assert.equal(merged.environmentOf.get("a"), "home");
  const sections = homeSections(merged.sessions, merged.projects, "", merged.pinnedSessionIds);
  assert.deepEqual(sections.pinned.map((item) => item.id), ["a"]);
  assert.deepEqual(sections.recent.map((item) => item.id), ["b", "dup"]);
  // Searching finds the other computer's project names.
  assert.deepEqual(homeSections(merged.sessions, merged.projects, "api").recent.map((item) => item.id), ["b"]);
});

test("pairing with another computer posts to its address and reads what it is", async () => {
  const calls: string[] = [];
  const result = await redeemPairingAt(VPS, "482913", "iPhone · Safari", (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ token: "tok", host: { id: "abc", hostName: "sirus-vps", kind: "server" } }), { status: 200 });
  }) as typeof fetch);
  assert.deepEqual(calls, [`${VPS}/api/pair`]);
  assert.deepEqual(result, { token: "tok", host: { id: "abc", hostName: "sirus-vps", kind: "server" } });
  await assert.rejects(redeemPairingAt(VPS, "000000", "x", (async () => new Response(JSON.stringify({ message: "This code is not valid." }), { status: 401 })) as typeof fetch), /not valid/);
});

test("the phone's client moves its calls and listeners to the computer it switches to", async () => {
  const log: string[] = [];
  const fake = (name: string): Transport & { emit: (event: string, payload: unknown) => void } => {
    const handlers = new Map<string, Set<(payload: unknown) => void>>();
    return {
      async invoke<T>(command: string) { log.push(`${name}:${command}`); return name as T; },
      async listen<T>(event: string, handler: (payload: T) => void) {
        const set = handlers.get(event) ?? new Set();
        handlers.set(event, set);
        set.add(handler as (payload: unknown) => void);
        log.push(`${name}:listen:${event}`);
        return () => { set.delete(handler as (payload: unknown) => void); log.push(`${name}:unlisten:${event}`); };
      },
      thumbnailUrl: (id: string) => `${name}/${id}`,
      emit: (event, payload) => { for (const handler of handlers.get(event) ?? []) handler(payload); },
    };
  };
  const mac = fake("mac");
  const vps = fake("vps");
  const transport = new SwitchingTransport(mac);
  const seen: unknown[] = [];
  const stop = await transport.listen("session-updated", (payload) => seen.push(payload));
  assert.equal(await transport.invoke("load_state"), "mac");
  transport.use(vps);
  await Promise.resolve();
  assert.equal(await transport.invoke("load_state"), "vps");
  assert.equal(transport.thumbnailUrl("x"), "vps/x");
  mac.emit("session-updated", "from mac");
  vps.emit("session-updated", "from vps");
  assert.deepEqual(seen, ["from vps"]);
  stop();
  await Promise.resolve();
  vps.emit("session-updated", "late");
  assert.deepEqual(seen, ["from vps"]);
  assert.ok(log.includes("mac:unlisten:session-updated") && log.includes("vps:unlisten:session-updated"));
});

test("waiting messages go only to the computer their conversation is on", async () => {
  const storage = memory();
  enqueueMessage({ sessionId: "on-vps", prompt: "one" }, storage);
  enqueueMessage({ sessionId: "on-mac", prompt: "two" }, storage);
  const sent: string[] = [];
  const count = await flushOutbox(async (message) => { sent.push(message.prompt); return true; }, storage, (message) => message.sessionId === "on-mac");
  assert.equal(count, 1);
  assert.deepEqual(sent, ["two"]);
  assert.deepEqual(readOutbox(storage).map((item) => item.prompt), ["one"]);
});
