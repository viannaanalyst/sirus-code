import { test } from "node:test";
import assert from "node:assert/strict";
import { composerContextForOwner, composerDebugging, composerPlanning, composerPrompt } from "../src/lib/composer-context.ts";
import { useAppStore } from "../src/store/app-store.ts";
import { client, SirusClient } from "../src/client/index.ts";
import type { Session, SendPromptRequest } from "../src/client/types.ts";

const session: Session = { id: "extras-owner", projectId: "extras-project", agent: "codex", title: "Task", status: "idle", createdAt: "time", lastActivityAt: "time", worktree: { path: "/fixture", branch: "main", isolated: false }, messages: [], lastError: null, goal: "Persistent objective" };
test("debug and planning are exclusive without granting or restoring approval access", () => {
  const initial = { attachments: [], goal: "Goal", planning: false, approvalByProvider: { codex: "full" as const } };
  const debug = composerDebugging(initial, true);
  assert.equal(debug.planning, false);
  assert.equal(debug.approvalByProvider?.codex, "full");
  const plan = composerPlanning(debug, true);
  assert.equal(plan.debugging, false);
  assert.equal(plan.approvalByProvider?.codex, "ask");
  assert.equal(composerDebugging(plan, true).approvalByProvider?.codex, "ask");
  const prompt = composerPrompt("Reproduce the error", debug);
  assert.equal(prompt, "Reproduce the error");
  assert.ok(!composerPrompt("Task", { ...debug, planning: true }).includes("Debug mode"));
});

test("restored native goals remain bound to their session when adding attachments", () => {
  assert.equal(composerContextForOwner("session:extras-owner", {}, [session]).goal, session.goal);
  assert.equal(composerContextForOwner("session:foreign", {}, [session]).goal, "");
  const cleared = { attachments: [], goal: "", planning: false };
  assert.equal(composerContextForOwner("session:extras-owner", { "session:extras-owner": cleared }, [session]), cleared);
});

test("successful sends retain modes and goals, clear binary references and merge only goal metadata", async (context) => {
  let sent: SendPromptRequest | undefined;
  const newer = { ...session, messages: [{ id: "new-output", sessionId: session.id, role: "agent" as const, content: "Streaming newer output", createdAt: "time", streaming: true }] };
  context.mock.method(client, "saveComposerDraft", async () => undefined);
  context.mock.method(client, "sendPrompt", async (request: SendPromptRequest) => {
    sent = request;
    useAppStore.setState({ sessions: [newer] });
    return { ...session, goal: "Goal", messages: [] };
  });
  const draft = { attachments: [{ id: "image", name: "Window.jpg", kind: "file" as const, content: "", truncated: false }], goal: "Goal", planning: false, debugging: true };
  useAppStore.setState({ selectedSessionId: session.id, selectedProjectId: session.projectId, sessions: [session], composerDrafts: { [`session:${session.id}`]: "Task" }, composerContexts: { [`session:${session.id}`]: draft } });
  assert.equal(await useAppStore.getState().sendPrompt("Task"), true);
  assert.equal(sent?.goal, "Goal");
  assert.equal(sent?.debugging, true);
  assert.equal(sent?.prompt, "Task");
  assert.deepEqual(sent?.attachmentIds, ["image"]);
  assert.deepEqual(useAppStore.getState().composerContexts[`session:${session.id}`], { ...draft, attachments: [] });
  assert.equal(useAppStore.getState().sessions[0].messages, newer.messages);
  assert.equal(useAppStore.getState().sessions[0].goal, "Goal");
});

test("the capture Client sends only its draft owner and no renderer window identity", async () => {
  const calls: unknown[] = [];
  const fixture = new SirusClient({ invoke: async (command, args) => { calls.push({ command, args }); return [] as never; }, listen: async () => () => {} });
  await fixture.capturePromptWindow("session:extras-owner");
  assert.deepEqual(calls, [{ command: "capture_prompt_window", args: { owner: "session:extras-owner" } }]);
});

test("automatic browser capture preserves restored goals and clears submitted draft attachments", async (context) => {
  const owner = `session:${session.id}`;
  const capture = { id: "browser-image", name: "browser.png", kind: "file" as const, content: "", truncated: false };
  context.mock.method(client, "browserCapture", async () => "fixture-image");
  context.mock.method(client, "pastePromptAttachments", async () => [capture]);
  context.mock.method(client, "saveComposerDraft", async () => undefined);
  let sent: SendPromptRequest | undefined;
  context.mock.method(client, "sendPrompt", async (request: SendPromptRequest) => { sent = request; return { ...session, goal: request.goal ?? session.goal }; });
  useAppStore.setState({ selectedSessionId: session.id, selectedProjectId: session.projectId, sessions: [session], composerDrafts: {}, composerContexts: {}, browserBySession: { [session.id]: { sessionId: session.id, open: true, activeTabId: "tab", tabs: [{ id: "tab", url: "https://example.com", title: "Page", loading: false, canGoBack: false, canGoForward: false, faviconUrl: "" }] } } });
  assert.equal(await useAppStore.getState().sendPrompt("Veja a página"), true);
  assert.equal(sent?.goal, session.goal);
  assert.deepEqual(sent?.attachmentIds, [capture.id]);
  const draft = { attachments: [{ ...capture, id: "manual" }], goal: "Updated goal", planning: false, debugging: true };
  useAppStore.setState({ composerContexts: { [owner]: draft } });
  assert.equal(await useAppStore.getState().sendPrompt("Veja a página"), true);
  assert.deepEqual(sent?.attachmentIds, ["manual", capture.id]);
  assert.deepEqual(useAppStore.getState().composerContexts[owner], { ...draft, attachments: [] });

  // An edit made while Send is pending must not be cleared by its acknowledgment.
  useAppStore.setState({ composerContexts: { [owner]: draft } });
  const edited = { ...draft, attachments: [{ ...capture, id: "new-file" }], goal: "New unsent goal" };
  context.mock.method(client, "sendPrompt", async () => { useAppStore.setState({ composerContexts: { [owner]: edited } }); return session; });
  assert.equal(await useAppStore.getState().sendPrompt("Veja a página"), true);
  assert.equal(useAppStore.getState().composerContexts[owner], edited);

  // Capture waits may not admit a newer draft into the already-submitted turn.
  useAppStore.setState({ composerContexts: {} });
  context.mock.method(client, "browserCapture", async () => { useAppStore.setState({ composerContexts: { [owner]: edited } }); return "fixture-image"; });
  context.mock.method(client, "sendPrompt", async (request: SendPromptRequest) => { sent = request; return session; });
  assert.equal(await useAppStore.getState().sendPrompt("Veja a página"), true);
  assert.equal(sent?.goal, session.goal);
  assert.deepEqual(sent?.attachmentIds, [capture.id]);
  assert.equal(useAppStore.getState().composerContexts[owner], edited);

  // Batch overflow releases only the new unsent capture, preserving the draft.
  let released: string[] = [];
  let sends = 0;
  context.mock.method(client, "releasePromptAttachments", async (_owner: string, ids: string[]) => { released = ids; });
  context.mock.method(client, "browserCapture", async () => "fixture-image");
  context.mock.method(client, "sendPrompt", async () => { sends++; return session; });
  const full = { ...draft, attachments: Array.from({ length: 8 }, (_, index) => ({ ...capture, id: `manual-${index}` })) };
  useAppStore.setState({ composerContexts: { [owner]: full } });
  assert.equal(await useAppStore.getState().sendPrompt("Veja a página"), false);
  assert.equal(sends, 0);
  assert.deepEqual(released, [capture.id]);
  assert.equal(useAppStore.getState().composerContexts[owner], full);
});
