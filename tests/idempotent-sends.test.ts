import { test } from "node:test";
import assert from "node:assert/strict";
import { client } from "../src/client/index.ts";
import { observePromptQueue, useAppStore } from "../src/store/app-store.ts";
import { defaultSettings } from "../src/lib/settings.ts";
import { newRequestId } from "../src/lib/ids.ts";
import { enqueueMessage, flushOutbox, readOutbox, retargetQueued, type QueuedMessage } from "../src/lib/phone-outbox.ts";
import type { SendPromptRequest, Session } from "../src/client/types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const flush = () => new Promise(resolve => setImmediate(resolve));

function memory(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

test("a send id is a version 4 UUID, new for every send", () => {
  const ids = new Set(Array.from({ length: 50 }, () => newRequestId()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, UUID);
});

test("a send id stays a UUID where randomUUID or crypto is missing (plain http, Hermes)", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto")!;
  const real = globalThis.crypto;
  try {
    for (const stand of [{ getRandomValues: real.getRandomValues.bind(real) }, undefined]) {
      Object.defineProperty(globalThis, "crypto", { value: stand, configurable: true });
      const ids = new Set(Array.from({ length: 20 }, () => newRequestId()));
      assert.equal(ids.size, 20);
      for (const id of ids) assert.match(id, UUID);
    }
  } finally {
    Object.defineProperty(globalThis, "crypto", original);
  }
});

test("an outbox message keeps one send id across failed tries and a move to another computer", async () => {
  const storage = memory();
  const queued = enqueueMessage({ sessionId: "s", prompt: "Fix the build" }, storage);
  assert.match(queued.clientRequestId!, UUID);
  const tries: QueuedMessage[] = [];
  // The connection drops before the answer: the message stays and goes again later.
  assert.equal(await flushOutbox(async message => { tries.push(message); throw new Error("timed out"); }, storage), 0);
  assert.equal(await flushOutbox(async message => { tries.push(message); return false; }, storage), 0);
  assert.equal(retargetQueued("s", "s-on-vps", storage), 1);
  assert.equal(await flushOutbox(async message => { tries.push(message); return true; }, storage), 1);
  assert.deepEqual(tries.map(message => message.clientRequestId), [queued.clientRequestId, queued.clientRequestId, queued.clientRequestId]);
  assert.equal(tries[2].sessionId, "s-on-vps");
  assert.deepEqual(readOutbox(storage), []);
  // A second message is a second send.
  assert.notEqual(enqueueMessage({ sessionId: "s", prompt: "Fix the build" }, storage).clientRequestId, queued.clientRequestId);
});

test("an outbox message saved before send ids still reads and sends", async () => {
  const storage = memory();
  storage.setItem("sirus.outbox", JSON.stringify([{ id: "old", sessionId: "s", prompt: "Hello", createdAt: 1 }]));
  assert.equal(readOutbox(storage).length, 1);
  assert.equal(await flushOutbox(async message => message.clientRequestId === undefined, storage), 1);
});

const running = (): Session => ({ id: "idem", projectId: "p", title: "Task", agent: "codex", model: "model", providerAccountId: "profile", status: "running", createdAt: "time", lastActivityAt: "time", worktree: { path: "/fixture", branch: "main", isolated: true }, messages: [{ id: "first", sessionId: "idem", role: "agent", content: "", createdAt: "time", streaming: true }], lastError: null });

function setup(context: import("node:test").TestContext, session: Session) {
  context.mock.method(client, "saveComposerDraft", async () => undefined);
  useAppStore.setState({ sessions: [session], selectedSessionId: session.id, selectedProjectId: "p", projects: [], settings: defaultSettings, composerDrafts: {}, composerContexts: {}, promptQueues: {}, modelChangesPending: {}, error: null });
}

test("a queued request sends the id it got when written, the same on Resume after a failed try", async context => {
  const session = running();
  setup(context, session);
  const sent: SendPromptRequest[] = [];
  context.mock.method(client, "sendPrompt", async (request: SendPromptRequest) => { sent.push(request); throw new Error("connection lost"); });
  assert.equal(await useAppStore.getState().sendPrompt("next"), true);
  assert.equal(await useAppStore.getState().sendPrompt("after"), true);
  const [first, second] = useAppStore.getState().promptQueues[session.id].items;
  assert.match(first.clientRequestId!, UUID);
  assert.notEqual(first.clientRequestId, second.clientRequestId);
  const settled = { ...session, status: "completed" as const, messages: session.messages.map(message => ({ ...message, streaming: false })) };
  useAppStore.setState({ sessions: [settled] });
  observePromptQueue(settled);
  await flush();
  assert.equal(sent.length, 1);
  assert.equal(useAppStore.getState().promptQueues[session.id].paused, true);
  useAppStore.getState().resumePromptQueue(session.id);
  await flush();
  assert.deepEqual(sent.map(request => request.clientRequestId), [first.clientRequestId, first.clientRequestId]);
});

test("a direct send carries a new id per call, or the one a retry passes", async context => {
  const session = { ...running(), status: "completed" as const, messages: [] };
  setup(context, session);
  const sent: SendPromptRequest[] = [];
  context.mock.method(client, "sendPrompt", async (request: SendPromptRequest) => { sent.push(request); return session; });
  assert.equal(await useAppStore.getState().sendPrompt("one"), true);
  assert.equal(await useAppStore.getState().sendPrompt("two"), true);
  const retried = newRequestId();
  assert.equal(await useAppStore.getState().sendPrompt("three", undefined, session.id, retried), true);
  assert.equal(await useAppStore.getState().sendPrompt("three", undefined, session.id, retried), true);
  assert.match(sent[0].clientRequestId!, UUID);
  assert.notEqual(sent[0].clientRequestId, sent[1].clientRequestId);
  assert.deepEqual(sent.slice(2).map(request => request.clientRequestId), [retried, retried]);
});
