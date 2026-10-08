import { test } from "node:test";
import assert from "node:assert/strict";
import { client } from "../src/client/index.ts";
import { bindRealtime, observePromptQueue, useAppStore } from "../src/store/app-store.ts";
import { defaultSettings } from "../src/lib/settings.ts";
import type { SendPromptRequest, Session } from "../src/client/types.ts";
import { composerPrompt } from "../src/lib/composer-context.ts";

const fixture = (): Session => ({ id: "queue-owner", projectId: "p", title: "Task", agent: "codex", model: "model", providerAccountId: "profile", status: "running", createdAt: "time", lastActivityAt: "time", worktree: { path: "/fixture", branch: "main", isolated: true }, messages: [{ id: "first", sessionId: "queue-owner", role: "agent", content: "", createdAt: "time", streaming: true }], lastError: null });
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(context: import("node:test").TestContext) {
  context.mock.method(client, "saveComposerDraft", async () => undefined);
  const session = fixture();
  useAppStore.setState({ sessions: [session], selectedSessionId: session.id, selectedProjectId: "p", projects: [], settings: defaultSettings, composerDrafts: {}, composerContexts: {}, promptQueues: {}, modelChangesPending: {}, error: null });
  return session;
}
function snapshot(session: Session) {
  useAppStore.setState(state => ({ sessions: state.sessions.map(item => item.id === session.id ? session : item) }));
  observePromptQueue(session);
}
function settled(session: Session, status: Session["status"] = "completed"): Session {
  return { ...session, status, messages: session.messages.map(message => ({ ...message, streaming: false })) };
}
function admitted(session: Session, id: string): Session {
  return { ...session, status: "running", messages: [...session.messages, { ...session.messages[0], id, streaming: true }] };
}
async function enqueue(text: string) {
  const store = useAppStore.getState();
  store.setComposerDraft("session:queue-owner", text);
  return store.sendPrompt(text, { approval: "ask", planning: false, effort: null });
}

test("queue follows native successful turns in order, once, even in another selected session", async context => {
  const session = setup(context);
  const sent: SendPromptRequest[] = [];
  let finish!: (session: Session) => void;
  context.mock.method(client, "sendPrompt", (request: SendPromptRequest) => { sent.push(request); return new Promise<Session>(resolve => { finish = resolve; }); });
  assert.equal(await enqueue("second"), true);
  assert.equal(await enqueue("third"), true);
  assert.equal(sent.length, 0);
  assert.equal(useAppStore.getState().composerDrafts["session:queue-owner"], undefined);
  useAppStore.setState({ selectedSessionId: "another", composerDrafts: { "session:another": "keep my draft" } });
  snapshot(settled(session)); snapshot(settled(session));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].prompt, "second");
  assert.deepEqual(sent[0].queuedAfter, { agent: "codex", model: "model", providerAccountId: "profile", worktreePath: "/fixture", messageId: "first" });
  const second = admitted(settled(session), "second-answer");
  snapshot(second); finish(second); await flush();
  snapshot(settled(session)); // stale final event for the previous turn
  assert.equal(sent.length, 1);
  snapshot(settled(second)); snapshot(settled(second));
  assert.equal(sent.length, 2);
  assert.equal(sent[1].prompt, "third");
  const third = admitted(settled(second), "third-answer");
  snapshot(third); finish(third); await flush();
  assert.equal(useAppStore.getState().selectedSessionId, "another");
  assert.equal(useAppStore.getState().composerDrafts["session:another"], "keep my draft");
  assert.equal(useAppStore.getState().promptQueues[session.id].items.length, 0);
});

test("failure and explicit Stop pause; editing and cancellation do not send; Resume is explicit", async context => {
  const session = setup(context);
  let sent = 0;
  context.mock.method(client, "sendPrompt", async () => { sent++; throw new Error("startup failed before admission"); });
  context.mock.method(client, "stopAgent", async () => { snapshot(settled(session)); });
  await enqueue("next");
  snapshot(settled(session, "failed"));
  await flush(); assert.equal(sent, 0);
  const id = useAppStore.getState().promptQueues[session.id].items[0].id;
  assert.equal(useAppStore.getState().editQueuedPrompt(session.id, id, "edited"), true);
  assert.equal(useAppStore.getState().editQueuedPrompt(session.id, id, ""), false);
  useAppStore.getState().resumePromptQueue(session.id); await flush();
  assert.equal(sent, 1);
  assert.equal(useAppStore.getState().promptQueues[session.id].paused, true);
  assert.equal(useAppStore.getState().promptQueues[session.id].items[0].prompt, "edited");
  snapshot(session);
  useAppStore.getState().resumePromptQueue(session.id);
  await useAppStore.getState().stopAgent(); await flush();
  assert.equal(sent, 1);
  useAppStore.getState().cancelQueuedPrompt(session.id, id);
  assert.equal(useAppStore.getState().promptQueues[session.id].items.length, 0);
});

test("queued options and attachments are snapshots, retained until cancellation, with bounded requests", async context => {
  const session = setup(context);
  const released: string[][] = [];
  context.mock.method(client, "releasePromptAttachments", async (_owner: string, ids: string[]) => { released.push(ids); });
  const file = { id: "file", owner: "session:queue-owner", name: "report.pdf", kind: "file" as const, content: "reference", truncated: false };
  const owner = "session:queue-owner";
  useAppStore.getState().setComposerContext(owner, { attachments: [file], goal: "saved goal", planning: false, debugging: true });
  useAppStore.getState().setComposerDraft(owner, "analyze");
  const original = useAppStore.getState().composerContexts[owner];
  await useAppStore.getState().sendPrompt(composerPrompt("analyze", original), { approval: "auto", fast: true });
  assert.equal(released.length, 0);
  useAppStore.getState().setComposerContext(owner, { attachments: [], goal: "new goal", planning: true });
  const item = useAppStore.getState().promptQueues[session.id].items[0];
  assert.equal(item.context.goal, "saved goal"); assert.equal(item.context.debugging, true);
  assert.deepEqual(item.execution, { approval: "auto", fast: true });
  useAppStore.getState().cancelQueuedPrompt(session.id, item.id);
  assert.deepEqual(released, [["file"]]);
  for (let index = 0; index < 8; index++) assert.equal(await enqueue(`request ${index}`), true);
  assert.equal(await enqueue("ninth"), false);
  assert.equal(useAppStore.getState().composerDrafts[owner], "ninth");
  useAppStore.setState({ promptQueues: {} });
  assert.equal(await enqueue("á".repeat(33000)), false);
});

test("model/account/workspace changes pause without sending under another identity", async context => {
  const session = setup(context);
  let sent = 0;
  context.mock.method(client, "sendPrompt", async () => { sent++; return session; });
  await enqueue("next");
  snapshot({ ...settled(session), providerAccountId: "other-profile" });
  assert.equal(sent, 0);
  assert.equal(useAppStore.getState().promptQueues[session.id].reason, "queue.contextChanged");
  useAppStore.getState().resumePromptQueue(session.id);
  assert.equal(sent, 0);
});

test("completion before send returns advances, but admitted startup errors are never replayed", async context => {
  const session = setup(context);
  let sent = 0;
  context.mock.method(client, "sendPrompt", async (request: SendPromptRequest) => {
    sent++;
    const live = useAppStore.getState().sessions[0];
    const next = admitted({ ...live, messages: [...live.messages, { ...live.messages[0], role: "user", content: request.prompt, id: `request-${sent}`, streaming: false }] }, `answer-${sent}`);
    snapshot(next);
    snapshot(settled(next, sent === 1 ? "completed" : "failed"));
    if (sent === 2) throw new Error("failure after admission");
    return next;
  });
  await enqueue("second"); await enqueue("third"); await enqueue("fourth");
  snapshot(settled(session)); await flush();
  assert.equal(sent, 2);
  assert.deepEqual(useAppStore.getState().promptQueues[session.id].items.map(item => item.prompt), ["fourth"]);
  assert.equal(useAppStore.getState().promptQueues[session.id].paused, true);
});

test("an error before delayed admission events never rebases or replays the same request", async context => {
  const session = setup(context);
  let actual = settled(session);
  let admissions = 0;
  context.mock.method(client, "sendPrompt", async (request: SendPromptRequest) => {
    // The native guard sees newer history even when its event has not arrived.
    const actualPredecessor = actual.messages[actual.messages.length - 1].id;
    if (request.queuedAfter?.messageId !== actualPredecessor) throw new Error("stale queued predecessor");
    admissions++;
    actual = settled(admitted({ ...actual, messages: [...actual.messages, { ...actual.messages[0], role: "user", id: "admitted-user", content: request.prompt, streaming: false }] }, "admitted-answer"), "failed");
    throw new Error("failure after native admission but before event delivery");
  });
  await enqueue("second"); await enqueue("third");
  snapshot(settled(session)); await flush();
  assert.equal(admissions, 1);
  const id = useAppStore.getState().promptQueues[session.id].items[0].id;
  assert.equal(useAppStore.getState().editQueuedPrompt(session.id, id, "different"), false, "ambiguous admission cannot be edited into another request");
  useAppStore.getState().resumePromptQueue(session.id); await flush();
  assert.equal(admissions, 1, "native expected predecessor prevents replay before the event arrives");
  snapshot(actual); snapshot(actual); await flush();
  assert.deepEqual(useAppStore.getState().promptQueues[session.id].items.map(item => item.text), ["third"]);
  assert.equal(useAppStore.getState().promptQueues[session.id].paused, true);
});

test("editing an attachment-only request does not duplicate composed reference text", async context => {
  const session = setup(context);
  const owner = `session:${session.id}`;
  const composer = { attachments: [{ id: "file", kind: "file" as const, name: "report.pdf", content: "reference", truncated: false }], goal: "", planning: false };
  useAppStore.getState().setComposerContext(owner, composer);
  await useAppStore.getState().sendPrompt(composerPrompt("", composer));
  const item = useAppStore.getState().promptQueues[session.id].items[0];
  assert.equal(item.text, "");
  assert.equal(useAppStore.getState().editQueuedPrompt(session.id, item.id, ""), true);
  assert.equal(useAppStore.getState().promptQueues[session.id].items[0].prompt, item.prompt);
});

test("completed IPC before its event waits for matching native history before the next send", async context => {
  const session = setup(context);
  let calls = 0;
  let actual = settled(session);
  context.mock.method(client, "sendPrompt", async (request: SendPromptRequest) => {
    assert.equal(request.queuedAfter?.messageId, actual.messages[actual.messages.length - 1].id);
    calls++;
    actual = settled(admitted({ ...actual, messages: [...actual.messages, { ...actual.messages[0], role: "user", content: request.prompt, id: `user-${calls}`, streaming: false }] }, `answer-${calls}`));
    return actual;
  });
  await enqueue("second"); await enqueue("third");
  snapshot(settled(session)); await flush();
  assert.equal(calls, 1);
  assert.equal(useAppStore.getState().promptQueues[session.id].waitingFor, "answer-1");
  useAppStore.getState().pausePromptQueue(session.id);
  useAppStore.getState().resumePromptQueue(session.id); await flush();
  assert.equal(calls, 1, "Continue does not bypass the pending native completion event");
  snapshot(actual); await flush();
  assert.equal(calls, 2);
  snapshot(actual); await flush();
  assert.equal(useAppStore.getState().promptQueues[session.id].items.length, 0);
});

test("native admission clears the initial draft once while startup IPC is pending, preserving same-text new edits", async context => {
  const session = { ...setup(context), status: "idle" as const, messages: [] };
  useAppStore.setState({ sessions: [session], composerDrafts: { "session:queue-owner": "again" } });
  let resolve!: (session: Session) => void;
  context.mock.method(client, "sendPrompt", () => new Promise<Session>(done => { resolve = done; }));
  let updated!: (session: Session) => void;
  context.mock.method(client, "onSessionUpdated", async (handler: typeof updated) => { updated = handler; return () => {}; });
  context.mock.method(client, "onAstrosChanged", async () => () => {});
  context.mock.method(client, "onAutomationsChanged", async () => () => {});
  context.mock.method(client, "onCiAutofixChanged", async () => () => {});
  context.mock.method(client, "ciAutofixAction", async () => []);
  context.mock.method(client, "onPrWatchChanged", async () => () => {});
  context.mock.method(client, "prWatchAction", async () => []);
  context.mock.method(client, "onWindowSnap", async () => () => {});
  for (const method of ["onAgentOutput", "onMemoryPressure", "onAgentExit", "onPtyOutput", "onBrowserState", "onBrowserCapture", "onComputerState", "onSecretState", "onActivityNotification", "onNotificationOpen"] as const) context.mock.method(client, method, async () => () => {});
  const unbind = await bindRealtime();
  const request = useAppStore.getState().sendPrompt("again");
  await flush();
  const starting: Session = { ...session, status: "starting", messages: [{ id: "request", sessionId: session.id, role: "user", content: "again", createdAt: "time", streaming: false }, { id: "response", sessionId: session.id, role: "agent", content: "", createdAt: "time", streaming: true }] };
  updated(starting);
  assert.equal(useAppStore.getState().composerDrafts["session:queue-owner"], undefined);
  assert.equal(await enqueue("during startup"), true);
  assert.equal(useAppStore.getState().promptQueues[session.id].items[0].text, "during startup");
  useAppStore.getState().setComposerDraft("session:queue-owner", "again");
  resolve(starting); await request;
  assert.equal(useAppStore.getState().composerDrafts["session:queue-owner"], "again");
  unbind();
});

test("preparing a queued screenshot preserves identity and Stop/failure pauses instead of restarting", async context => {
  context.mock.method(client, "saveComposerDraft", async () => undefined);
  context.mock.method(client, "pastePromptAttachments", async () => [{ id: "capture", name: "browser.png", kind: "file", content: "", truncated: false }]);
  context.mock.method(client, "releasePromptAttachments", async () => undefined);
  let resolve!: (data: string) => void;
  context.mock.method(client, "browserCapture", () => new Promise<string>(done => { resolve = done; }));
  let sends = 0;
  context.mock.method(client, "sendPrompt", async () => { sends++; return fixture(); });
  for (const outcome of ["stopped", "failed", "model-changed", "stop-raced-success"] as const) {
    const session = setup(context);
    useAppStore.setState({ browserBySession: { [session.id]: { sessionId: session.id, open: true, activeTabId: "tab", tabs: [{ id: "tab", url: "https://example.com", title: "Fixture", faviconUrl: "", canGoBack: false, canGoForward: false, loading: false }] } } });
    useAppStore.getState().setComposerDraft(`session:${session.id}`, "Check the browser page");
    const request = useAppStore.getState().sendPrompt("Check the browser page", { approval: "full", effort: "high" });
    await flush();
    if (outcome === "stopped") useAppStore.getState().pausePromptQueue(session.id);
    snapshot(outcome === "model-changed" ? { ...settled(session), model: "different" } : settled(session, outcome === "stop-raced-success" ? "completed" : outcome));
    if (outcome === "stop-raced-success") useAppStore.getState().pausePromptQueue(session.id);
    resolve("png");
    assert.equal(await request, outcome !== "model-changed");
    assert.equal(sends, 0);
    if (outcome !== "model-changed") {
      assert.equal(useAppStore.getState().promptQueues[session.id].paused, true);
      assert.equal(useAppStore.getState().promptQueues[session.id].items[0].text, "Check the browser page");
    } else assert.equal(useAppStore.getState().composerDrafts[`session:${session.id}`], "Check the browser page");
  }
});
