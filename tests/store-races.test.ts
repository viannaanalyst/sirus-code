import { test } from "node:test";
import assert from "node:assert/strict";
import { client } from "../src/client/index.ts";
import { bindRealtime, useAppStore } from "../src/store/app-store.ts";
import { defaultSettings } from "../src/lib/settings.ts";
import type { AppSettings, GitStatus, Project } from "../src/client/types.ts";
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const ownedSession = (id: string, projectId = "project"): import("../src/client/types.ts").Session => ({ id, projectId, title: "Task", agent: "codex", status: "idle", createdAt: "time", lastActivityAt: "time", messages: [], worktree: { path: "/fixture", branch: "main", isolated: true }, lastError: null });
const status = (branch: string): GitStatus => ({ identity: { isRepo: true, root: "/test", branch, detached: false }, dirty: false, ahead: 0, behind: 0, changes: [] });

test("pin acknowledgments serialize without replacing newer output and old snapshots cannot undo them", async (context) => {
  const first = deferred<string[]>();
  context.mock.method(client, "setMessagePinned", (_session: string, _message: string, pinned: boolean) => pinned ? first.promise : Promise.resolve([]));
  const fixture: import("../src/client/types.ts").Session = { id: "pin-owner", projectId: "p", title: "Task", agent: "codex", status: "completed", createdAt: "time", lastActivityAt: "time", worktree: { path: "/fixture", branch: "main", isolated: false }, messages: [{ id: "answer", sessionId: "pin-owner", role: "agent", content: "Original", createdAt: "time", streaming: false }], lastError: null, pinnedMessageIds: [] };
  useAppStore.setState({ sessions: [fixture], error: null });
  const pin = useAppStore.getState().setMessagePinned(fixture.id, "answer", true);
  const unpin = useAppStore.getState().setMessagePinned(fixture.id, "answer", false);
  await new Promise(resolve => setImmediate(resolve));
  const newer = { ...fixture, messages: [...fixture.messages, { ...fixture.messages[0], id: "newer", content: "Newer output" }] };
  useAppStore.setState({ sessions: [newer] });
  first.resolve(["answer"]);
  await Promise.all([pin, unpin]);
  assert.deepEqual(useAppStore.getState().sessions[0].pinnedMessageIds, []);
  assert.equal(useAppStore.getState().sessions[0].messages, newer.messages);
  await useAppStore.getState().setMessagePinned(fixture.id, "answer", true);
  let snapshot!: (session: import("../src/client/types.ts").Session) => void;
  context.mock.method(client, "onSessionUpdated", async (handler: typeof snapshot) => { snapshot = handler; return () => {}; });
  context.mock.method(client, "onAstrosChanged", async () => () => {});
  context.mock.method(client, "onAutomationsChanged", async () => () => {});
  context.mock.method(client, "onCiAutofixChanged", async () => () => {});
  context.mock.method(client, "onSimulatorOpen", async () => () => {});
  context.mock.method(client, "ciAutofixAction", async () => []);
  context.mock.method(client, "onWindowSnap", async () => () => {});
  context.mock.method(client, "onAgentOutput", async () => () => {});
  context.mock.method(client, "onAgentExit", async () => () => {});
  context.mock.method(client, "onPtyOutput", async () => () => {});
  context.mock.method(client, "onBrowserState", async () => () => {});
  context.mock.method(client, "onBrowserCapture", async () => () => {});
  context.mock.method(client, "onComputerState", async () => () => {});
  context.mock.method(client, "onActivityNotification", async () => () => {});
  context.mock.method(client, "onNotificationOpen", async () => () => {});
  const unbind = await bindRealtime();
  snapshot({ ...newer, status: "running", pinnedMessageIds: [] });
  assert.deepEqual(useAppStore.getState().sessions[0].pinnedMessageIds, ["answer"]);
  assert.equal(useAppStore.getState().sessions[0].status, "running");
  unbind();
});

test("late fork creation preserves the selected session and existing drafts", async (context) => {
  const created = deferred<import("../src/client/types.ts").Session>();
  context.mock.method(client, "forkSession", () => created.promise);
  context.mock.method(client, "gitStatus", async () => status("other"));
  const source: import("../src/client/types.ts").Session = { id: "fork-owner", projectId: "p", title: "Task", agent: "codex", status: "completed", createdAt: "time", lastActivityAt: "time", worktree: { path: "/fixture", branch: "main", isolated: false }, messages: [], lastError: null };
  const drafts = { "session:fork-owner": "unsent", "session:other": "other draft" };
  useAppStore.setState({ sessions: [source], selectedSessionId: source.id, selectedProjectId: "p", composerDrafts: drafts, mainView: "session" });
  const request = useAppStore.getState().forkSession(source.id, "answer");
  useAppStore.setState({ selectedSessionId: "other", selectedProjectId: "other-project" });
  created.resolve({ ...source, id: "new-fork", status: "idle", nativeThread: null });
  assert.equal(await request, true);
  assert.equal(useAppStore.getState().selectedSessionId, "other");
  assert.equal(useAppStore.getState().selectedProjectId, "other-project");
  assert.equal(useAppStore.getState().composerDrafts, drafts);
  assert.equal(useAppStore.getState().sessions[0].id, "new-fork");
  assert.equal(useAppStore.getState().sessions[1], source);
});

test("switching a fork provider adopts native account binding and bootstrap metadata", async (context) => {
  const source: import("../src/client/types.ts").Session = { id: "handoff", projectId: "p", title: "Task", agent: "codex", providerAccountId: "codex-profile", accountBindings: { codex: "codex-profile" }, status: "idle", createdAt: "time", lastActivityAt: "time", worktree: { path: "/fixture", branch: "main", isolated: true }, messages: [], lastError: null, forkOrigin: { sourceSessionId: "original", sourceMessageId: "answer", sourceTitle: "Original", inheritedMessageCount: 1, seededNativeThreadId: "previous-thread" } };
  const native = { ...source, agent: "claude" as const, providerAccountId: "claude-profile", accountBindings: { ...source.accountBindings, claude: "claude-profile" }, forkOrigin: { ...source.forkOrigin!, seededNativeThreadId: null }, nativeThread: null };
  context.mock.method(client, "setSessionModel", async () => native);
  context.mock.method(client, "saveSettings", async (settings: AppSettings) => settings);
  useAppStore.setState({ sessions: [source], selectedSessionId: source.id, settings: defaultSettings });
  await useAppStore.getState().setSessionModel("claude", null);
  const selected = useAppStore.getState().sessions[0];
  assert.equal(selected.providerAccountId, "claude-profile");
  assert.deepEqual(selected.accountBindings, { codex: "codex-profile", claude: "claude-profile" });
  assert.equal(selected.forkOrigin?.seededNativeThreadId, null);
  assert.equal(selected.messages, source.messages);
});

test("opening a board session preserves execution state and unsent drafts", async (context) => {
  context.mock.method(client, "gitStatus", async () => status("main"));
  const sessions = [{ id: "board-card", projectId: "owned", status: "running", messages: [{ content: "stream" }] }] as import("../src/client/types.ts").Session[];
  const drafts = { "session:board-card": "unsent" };
  useAppStore.setState({ mainView: "session", sessions, composerDrafts: drafts, selectedSessionId: null });
  useAppStore.getState().setMainView("kanban");
  assert.equal(useAppStore.getState().selectedSessionId, null);
  await useAppStore.getState().selectSession("board-card");
  assert.equal(useAppStore.getState().mainView, "session");
  assert.equal(useAppStore.getState().selectedProjectId, "owned");
  assert.equal(useAppStore.getState().selectedSessionId, "board-card");
  assert.equal(useAppStore.getState().sessions, sessions);
  assert.equal(useAppStore.getState().composerDrafts, drafts);
});

test("an old Git response cannot replace the newly selected session", async (context) => {
  const first = deferred<GitStatus>();
  const second = deferred<GitStatus>();
  context.mock.method(client, "gitStatus", (id: string) => id === "first" ? first.promise : second.promise);
  useAppStore.setState({ selectedSessionId: "first", gitStatus: null });
  const oldRequest = useAppStore.getState().refreshGitStatus();
  useAppStore.setState({ selectedSessionId: "second" });
  const newRequest = useAppStore.getState().refreshGitStatus();
  second.resolve(status("second")); await newRequest;
  first.resolve(status("first")); await oldRequest;
  assert.equal(useAppStore.getState().gitStatus?.identity.branch, "second");
});

test("rapid preference changes preserve both favorites and persist in order", async (context) => {
  const saved: string[][] = [];
  context.mock.method(client, "saveSettings", async (settings: AppSettings) => { saved.push([...settings.favoriteModels]); await new Promise((resolve) => setTimeout(resolve, 5)); return settings; });
  useAppStore.setState({ settings: { ...defaultSettings, favoriteModels: [] } });
  const first = useAppStore.getState().saveSettings({ ...useAppStore.getState().settings, favoriteModels: ["codex::one"] });
  const second = useAppStore.getState().saveSettings({ ...useAppStore.getState().settings, favoriteModels: [...useAppStore.getState().settings.favoriteModels, "cursor::two"] });
  await Promise.all([first, second]);
  assert.deepEqual(saved, [["codex::one"], ["codex::one", "cursor::two"]]);
  assert.deepEqual(useAppStore.getState().settings.favoriteModels, ["codex::one", "cursor::two"]);
});

test("two refreshes of the same session keep the latest response", async (context) => {
  const first = deferred<GitStatus>(), second = deferred<GitStatus>(); let count = 0;
  context.mock.method(client, "gitStatus", () => ++count === 1 ? first.promise : second.promise);
  useAppStore.setState({ selectedSessionId: "same", gitStatus: null });
  const oldRequest = useAppStore.getState().refreshGitStatus();
  const newRequest = useAppStore.getState().refreshGitStatus();
  second.resolve(status("new")); await newRequest;
  first.resolve(status("old")); await oldRequest;
  assert.equal(useAppStore.getState().gitStatus?.identity.branch, "new");
});

test("failed sends report failure so the composer can retain its prompt", async (context) => {
  context.mock.method(client, "sendPrompt", async () => { throw new Error("CLI unavailable"); });
  useAppStore.setState({ selectedSessionId: "existing", sessions: [ownedSession("existing")], promptQueues: {}, error: null });
  assert.equal(await useAppStore.getState().sendPrompt("keep this prompt"), false);
  assert.equal(useAppStore.getState().error, "CLI unavailable");
});

test("late project open responses cannot change the latest project selection", async (context) => {
  const first = deferred<Project>(), second = deferred<Project>();
  context.mock.method(client, "openProject", (id: string) => id === "first" ? first.promise : second.promise);
  useAppStore.setState({ projects: [], sessions: [], selectedProjectId: null });
  const oldRequest = useAppStore.getState().selectProject("first");
  const newRequest = useAppStore.getState().selectProject("second");
  const project = (id: string): Project => ({ id, name: id, path: `/tmp/${id}`, addedAt: "time", lastOpenedAt: "time" });
  second.resolve(project("second")); await newRequest;
  first.resolve(project("first")); await oldRequest;
  assert.equal(useAppStore.getState().selectedProjectId, "second");
});

test("opening a project keeps the sidebar project order", async (context) => {
  const project = (id: string, lastOpenedAt = "time"): Project => ({ id, name: id, path: `/tmp/${id}`, addedAt: "time", lastOpenedAt });
  context.mock.method(client, "openProject", async (id: string) => project(id, "later"));
  useAppStore.setState({ projects: [project("first"), project("second")], sessions: [], selectedProjectId: "first" });
  await useAppStore.getState().selectProject("second");
  assert.deepEqual(useAppStore.getState().projects.map((row) => [row.id, row.lastOpenedAt]), [["first", "time"], ["second", "later"]]);
});

test("sending in one session never clears another session's draft", async (context) => {
  context.mock.method(client, "saveComposerDraft", async () => undefined);
  const request = deferred<import("../src/client/types.ts").Session>();
  context.mock.method(client, "sendPrompt", () => request.promise);
  useAppStore.setState({ selectedSessionId: "one", sessions: [ownedSession("one")], promptQueues: {}, composerDrafts: { "session:one": "first", "session:two": "second" } });
  const send = useAppStore.getState().sendPrompt("first");
  useAppStore.setState({ selectedSessionId: "two" });
  request.resolve(ownedSession("one")); await send;
  assert.equal(useAppStore.getState().composerDrafts["session:two"], "second");
  assert.equal(useAppStore.getState().composerDrafts["session:one"], undefined);
});

test("a newer draft survives completion of the submitted prompt", async (context) => {
  context.mock.method(client, "saveComposerDraft", async () => undefined);
  const request = deferred<import("../src/client/types.ts").Session>();
  context.mock.method(client, "sendPrompt", () => request.promise);
  useAppStore.setState({ selectedSessionId: "one", sessions: [ownedSession("one")], promptQueues: {}, composerDrafts: { "session:one": "sent" } });
  const send = useAppStore.getState().sendPrompt("sent");
  useAppStore.getState().setComposerDraft("session:one", "next request");
  request.resolve(ownedSession("one")); await send;
  assert.equal(useAppStore.getState().composerDrafts["session:one"], "next request");
});

test("editing the project draft during session creation transfers the latest text", async (context) => {
  context.mock.method(client, "saveComposerDraft", async () => undefined);
  const request = deferred<import("../src/client/types.ts").Session>();
  context.mock.method(client, "createSession", () => request.promise);
  context.mock.method(client, "sendPrompt", async () => ownedSession("new"));
  useAppStore.setState({ selectedProjectId: "project", selectedSessionId: null, sessions: [], settings: defaultSettings, composerDrafts: { "project:project": "submitted" } });
  const send = useAppStore.getState().sendPrompt("submitted");
  useAppStore.getState().setComposerDraft("project:project", "next prompt");
  request.resolve(ownedSession("new"));
  await send;
  assert.equal(useAppStore.getState().composerDrafts["session:new"], "next prompt");
  assert.equal(useAppStore.getState().composerDrafts["project:project"], undefined);
});

test("bootstrap reopening preference retains sessions and drafts without starting agents", async (context) => {
  const project: Project = { id: "owner", name: "Fixture", path: "/tmp/fixture", addedAt: "time", lastOpenedAt: "time" };
  const sessions = [{ id: "orphan", projectId: "missing" }, { id: "saved", projectId: "owner", messages: [{ content: "retained" }], worktree: { path: "/tmp/fixture" } }] as import("../src/client/types.ts").Session[];
  const drafts = { "session:saved": "unsent" };
  let restorePreviousSessions = false;
  let openLastProject = true;
  let archivedSessionIds: string[] = [];
  context.mock.method(client, "loadState", async () => ({ projects: [project], sessions, composerDrafts: drafts, settings: { ...defaultSettings, restorePreviousSessions, openLastProject, archivedSessionIds } }));
  context.mock.method(client, "detectAgents", async () => []);
  context.mock.method(client, "gitIdentity", async () => status("main").identity);
  context.mock.method(client, "gitStatus", async () => status("main"));
  let sends = 0;
  context.mock.method(client, "sendPrompt", async () => { sends++; throw new Error("boot must not send"); });
  await useAppStore.getState().bootstrap();
  assert.equal(useAppStore.getState().selectedSessionId, null);
  assert.equal(useAppStore.getState().sessions, sessions);
  assert.equal(useAppStore.getState().composerDrafts, drafts);
  restorePreviousSessions = true;
  await useAppStore.getState().bootstrap();
  assert.equal(useAppStore.getState().selectedSessionId, "saved");
  archivedSessionIds = ["saved"];
  await useAppStore.getState().bootstrap();
  assert.equal(useAppStore.getState().selectedSessionId, null);
  assert.equal(useAppStore.getState().sessions, sessions);
  assert.equal(useAppStore.getState().composerDrafts, drafts);
  openLastProject = false;
  await useAppStore.getState().bootstrap();
  assert.equal(useAppStore.getState().selectedProjectId, null);
  assert.equal(useAppStore.getState().selectedSessionId, null);
  assert.equal(sends, 0);
});

test("execution options travel with the captured turn and newer context survives completion", async (context) => {
  context.mock.method(client, "saveComposerDraft", async () => undefined);
  const pending = deferred<import("../src/client/types.ts").Session>();
  let sent:import("../src/client/types.ts").SendPromptRequest | undefined;
  context.mock.method(client, "sendPrompt", (request:import("../src/client/types.ts").SendPromptRequest) => { sent=request;return pending.promise; });
  const initial={attachments:[],goal:"First goal",planning:true};
  useAppStore.setState({selectedSessionId:"one",sessions:[ownedSession("one")],promptQueues:{},composerDrafts:{"session:one":"Task"},composerContexts:{"session:one":initial,"session:two":{...initial,goal:"Other goal"}}});
  const send=useAppStore.getState().sendPrompt("Task",{effort:"high",fast:true,planning:true});
  useAppStore.setState({selectedSessionId:"two",composerContexts:{...useAppStore.getState().composerContexts,"session:one":{...initial,goal:"Next goal"}}});
  pending.resolve({} as import("../src/client/types.ts").Session);await send;
  assert.equal(sent?.sessionId,"one");assert.deepEqual(sent?.execution,{effort:"high",fast:true,planning:true});
  assert.equal(useAppStore.getState().composerContexts["session:one"].goal,"Next goal");assert.equal(useAppStore.getState().composerContexts["session:two"].goal,"Other goal");
});

test("approval choices stay owner and provider scoped while submitted references clear", async (context) => {
  context.mock.method(client, "saveComposerDraft", async () => undefined);
  let sent: import("../src/client/types.ts").SendPromptRequest | undefined;
  context.mock.method(client, "sendPrompt", async (request: import("../src/client/types.ts").SendPromptRequest) => { sent = request; return ownedSession(request.sessionId); });
  const approvalByProvider = { codex: "full" as const, claude: "ask" as const };
  const initial = { attachments: [], goal: "Goal", planning: false, approvalByProvider };
  const other = { attachments: [], goal: "Other", planning: false };
  useAppStore.setState({ selectedSessionId: "approval-owner", sessions: [ownedSession("approval-owner")], promptQueues: {}, composerDrafts: { "session:approval-owner": "Task" }, composerContexts: { "session:approval-owner": initial, "session:other": other } });
  assert.equal(await useAppStore.getState().sendPrompt("Task", { approval: "full" }), true);
  assert.equal(sent?.execution?.approval, "full");
  assert.deepEqual(useAppStore.getState().composerContexts["session:approval-owner"], initial);
  assert.equal(sent?.goal, "Goal");
  assert.equal(useAppStore.getState().composerContexts["session:other"], other);
});

test("failed first turn retains the transferred attachments and goal for retry", async (context) => {
  context.mock.method(client,"saveComposerDraft",async()=>undefined);
  context.mock.method(client,"createSession",async()=>ownedSession("created", "p"));
  context.mock.method(client,"sendPrompt",async()=>{throw new Error("Unavailable");});
  const reference={attachments:[{id:"a",name:"file.txt",kind:"file" as const,content:"Context",truncated:false}],goal:"Goal",planning:true};
  useAppStore.setState({selectedSessionId:null,selectedProjectId:"p",sessions:[],settings:defaultSettings,composerDrafts:{"project:p":"Task"},composerContexts:{"project:p":reference}});
  assert.equal(await useAppStore.getState().sendPrompt("Task"),false);
  assert.equal(useAppStore.getState().composerContexts["session:created"],reference);assert.equal(useAppStore.getState().composerContexts["project:p"],undefined);
});

test("a team request does not carry team mode into the created session", async (context) => {
  context.mock.method(client,"saveComposerDraft",async()=>undefined);
  context.mock.method(client,"createSession",async()=>ownedSession("team-created", "p"));
  context.mock.method(client,"sendPrompt",async()=>{throw new Error("Unavailable");});
  useAppStore.setState({selectedSessionId:null,selectedProjectId:"p",sessions:[],settings:defaultSettings,composerDrafts:{"project:p":"Split this"},composerContexts:{"project:p":{attachments:[],goal:"",planning:false,team:true}}});
  await useAppStore.getState().sendPrompt("Split this");
  assert.equal(useAppStore.getState().composerContexts["session:team-created"]?.team,false);
});

test("rapid model presets serialize per session and clear native identity and pending admission", async (context) => {
  const first=deferred<import("../src/client/types.ts").Session>();
  const calls:string[]=[];
  const fixture:import("../src/client/types.ts").Session = {id:"ordered",projectId:"p",title:"Task",agent:"cursor",model:"old",status:"completed",createdAt:"time",lastActivityAt:"time",worktree:{path:"/owned/workspace",branch:"main",isolated:false},messages:[],lastError:null,nativeThread:{threadId:"native",sessionId:"ordered",projectId:"p",cwd:"/owned/workspace",model:"old"}};
  context.mock.method(client,"setSessionModel",async(id:string,agent:import("../src/client/types.ts").AgentProviderId,model:string|null)=>{
    calls.push(model!);
    if (calls.length===1) return first.promise;
    return {...fixture,id,agent,model,nativeThread:null,pendingRequests:[],lastActivityAt:"last"};
  });
  context.mock.method(client,"saveSettings",async(settings:AppSettings)=>settings);
  useAppStore.setState({selectedSessionId:"ordered",sessions:[fixture],settings:defaultSettings,modelChangesPending:{}});
  const low=useAppStore.getState().setSessionModel("cursor","real-low");
  const high=useAppStore.getState().setSessionModel("cursor","real-high-fast");
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,["real-low"]);assert.equal(useAppStore.getState().modelChangesPending.ordered,2);
  first.resolve({...fixture,model:"real-low",nativeThread:null,pendingRequests:[],lastActivityAt:"first"});
  await Promise.all([low,high]);
  assert.deepEqual(calls,["real-low","real-high-fast"]);assert.equal(useAppStore.getState().sessions[0].model,"real-high-fast");
  assert.equal(useAppStore.getState().sessions[0].nativeThread,null);assert.deepEqual(useAppStore.getState().modelChangesPending,{});
  assert.equal(useAppStore.getState().settings.defaultModel,"cursor::real-high-fast");
});

test("send keeps attachment IDs bound to the original draft while creating a session", async (context) => {
  const created = deferred<import("../src/client/types.ts").Session>();
  let sent: import("../src/client/types.ts").SendPromptRequest | undefined;
  context.mock.method(client, "createSession", () => created.promise);
  context.mock.method(client, "sendPrompt", async (request: import("../src/client/types.ts").SendPromptRequest) => { sent = request; return ownedSession(request.sessionId); });
  useAppStore.setState({ selectedProjectId: "attachment-project", selectedSessionId: null, settings: defaultSettings, composerDrafts: { "project:attachment-project": "Look at this" }, composerContexts: { "project:attachment-project": { attachments: [{ id: "image-id", name: "screen.png", kind: "file", content: "", truncated: false }], planning: false, goal: "" } } });
  const sending = useAppStore.getState().sendPrompt("Look at this");
  useAppStore.setState({ selectedProjectId: "other-project", selectedSessionId: "other-session" });
  created.resolve({ id: "attachment-session", projectId: "attachment-project", title: "New session", agent: "codex", status: "idle", createdAt: "time", lastActivityAt: "time", worktree: { path: "/fixture", branch: "main", isolated: false }, messages: [], lastError: null });
  assert.equal(await sending, true);
  assert.deepEqual(sent && (sent as unknown as Record<string, unknown>).attachmentIds, ["image-id"]);
  assert.equal(sent && (sent as unknown as Record<string, unknown>).attachmentOwner, "project:attachment-project");
});

test("removing a transferred attachment releases its original native owner only after its last draft reference", (context) => {
  const released: { owner: string; ids: string[] }[] = [];
  context.mock.method(client, "releasePromptAttachments", async (owner: string, ids: string[]) => { released.push({ owner, ids }); });
  const file = { id: "shared-native-file", name: "image.png", kind: "file" as const, content: "", truncated: false, owner: "project:attachment-project" };
  const attached = { attachments: [file], goal: "", planning: false };
  const source = { id: "attachment-session", projectId: "attachment-project", title: "Task", agent: "codex", status: "idle", createdAt: "time", lastActivityAt: "time", worktree: { path: "/fixture", branch: "main", isolated: false }, messages: [], lastError: null } as import("../src/client/types.ts").Session;
  useAppStore.setState({ projects: [{ id: "attachment-project", name: "Fixture", path: "/fixture", addedAt: "time", lastOpenedAt: "time" }], sessions: [source], composerContexts: { "project:attachment-project": attached, "session:attachment-session": attached } });
  useAppStore.getState().setComposerContext("session:attachment-session", { ...attached, attachments: [] });
  assert.equal(released.length, 0);
  useAppStore.getState().setComposerContext("project:attachment-project", { ...attached, attachments: [] });
  assert.deepEqual(released, [{ owner: "project:attachment-project", ids: [file.id] }]);
});
