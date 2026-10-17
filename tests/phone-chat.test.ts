import { test } from "node:test";
import assert from "node:assert/strict";
import type { DiscoveredModel, FileEntry, ProviderModelList } from "../src/client/types.ts";
import { composerApproval } from "../src/lib/composer-approval.ts";
import { TERMINAL_CLEAR, TERMINAL_KEYS, withTerminalModifier } from "../src/lib/mobile.ts";
import { approvalOptions, chooseExecution, gitMenuSummary, isDefaultChoice, terminalRows, threadSettingsOptions, threadSettingsSections, threadSettingsSummary, visibleTreeRows, workspacePath } from "../src/lib/phone-chat.ts";
import { modelExecutionControls } from "../src/lib/execution-options.ts";
import { defaultSettings } from "../src/lib/settings.ts";

const model = (id: string, fields: Partial<DiscoveredModel> = {}): DiscoveredModel => ({ id, displayName: id, availability: "available", ...fields });

test("terminal keys: esc, CMD, CTRL, tab, paste, clear, then arrows", () => {
  assert.deepEqual(TERMINAL_KEYS.slice(0, 10).map((key) => key.id), ["esc", "cmd", "ctrl", "tab", "paste", "clear", "up", "down", "left", "right"]);
  assert.equal(TERMINAL_CLEAR, "\u000c");
});

test("CTRL makes control characters and marks arrows", () => {
  assert.equal(withTerminalModifier("c", "ctrl"), "\u0003");
  assert.equal(withTerminalModifier("C", "ctrl"), "\u0003");
  assert.equal(withTerminalModifier("[", "ctrl"), "\u001b");
  assert.equal(withTerminalModifier(" ", "ctrl"), "\u0000");
  assert.equal(withTerminalModifier("\u001b[D", "ctrl"), "\u001b[1;5D");
  assert.equal(withTerminalModifier("\t", "ctrl"), "\t");
  assert.equal(withTerminalModifier("x", null), "x");
});

test("CMD follows macOS line editing and passes the rest", () => {
  assert.equal(withTerminalModifier("\u001b[D", "cmd"), "\u0001");
  assert.equal(withTerminalModifier("\u001b[C", "cmd"), "\u0005");
  assert.equal(withTerminalModifier("\u007f", "cmd"), "\u0015");
  assert.equal(withTerminalModifier("k", "cmd"), TERMINAL_CLEAR);
  assert.equal(withTerminalModifier("a", "cmd"), "a");
  assert.equal(withTerminalModifier("\u001b[A", "cmd"), "\u001b[A");
});

test("approval: remembered per session, Full access by default, never during planning", () => {
  assert.deepEqual(composerApproval("codex", null, undefined, false), { requested: "full", effective: "full" });
  assert.deepEqual(composerApproval("codex", { agent: "codex", execution: { approval: "ask" } }, undefined, false), { requested: "ask", effective: "ask" });
  assert.deepEqual(composerApproval("codex", { agent: "claude", execution: { approval: "ask" } }, undefined, false).requested, "full");
  assert.deepEqual(composerApproval("codex", null, { codex: "auto" }, false).requested, "auto");
  assert.equal(composerApproval("codex", null, undefined, true).effective, "ask");
  assert.equal(composerApproval("cursor", null, { cursor: "full" }, true).effective, "auto");
});

test("approval rows keep the desktop order and mark unsupported modes", () => {
  assert.deepEqual(approvalOptions(["ask", "full"]), [{ mode: "ask", supported: true }, { mode: "auto", supported: false }, { mode: "full", supported: true }]);
});

test("reasoning and speed are saved per model, Cursor presets switch entries", () => {
  const codex = [model("gpt-5", { effortLevels: ["low", "medium", "high"], fastMode: true })];
  assert.deepEqual(chooseExecution("codex", "gpt-5", codex, { fast: true }, { effort: "high" }), { model: "gpt-5", preference: { fast: true, effort: "high" }, save: true });
  assert.equal(chooseExecution("codex", null, codex, {}, { effort: "high" }).save, false);
  const cursor = [model("gpt-5-low", { displayName: "GPT-5 Low" }), model("gpt-5-high", { displayName: "GPT-5 High" }), model("gpt-5-high-fast", { displayName: "GPT-5 High Fast" })];
  assert.deepEqual(chooseExecution("cursor", "gpt-5-low", cursor, {}, { effort: "high" }), { model: "gpt-5-high", preference: {}, save: false });
  assert.equal(chooseExecution("cursor", "gpt-5-high", cursor, {}, { fast: true }).model, "gpt-5-high-fast");
});

test("Thread settings lists enabled providers; a search hides empty sections", () => {
  const catalogs: Partial<Record<"codex" | "claude", ProviderModelList>> = {
    codex: { provider: "codex", source: "", note: "", models: [model("gpt-5.5", { displayName: "GPT-5.5" })] },
    claude: { provider: "claude", source: "", note: "", models: [model("claude-opus-5-5", { displayName: "Claude Opus 5.5" })] },
  };
  const settings = { ...defaultSettings, defaultModel: "claude::claude-opus-5-5", favoriteModels: [] };
  const all = threadSettingsSections(catalogs, settings, ["claude", "codex"], "codex", "gpt-5.5", "");
  assert.deepEqual(all.map((section) => [section.provider, section.rows.map((row) => row.model.id)]), [["claude", ["claude-opus-5-5"]], ["codex", ["gpt-5.5"]]]);
  assert.equal(isDefaultChoice(settings, all[0].rows[0]), true);
  assert.equal(isDefaultChoice(settings, all[1].rows[0]), false);
  assert.deepEqual(threadSettingsSections(catalogs, settings, ["claude", "codex"], "codex", "gpt-5.5", "opus").map((section) => section.provider), ["claude"]);
});

test("the summary shows only the options the selected model has", () => {
  const models = [model("gpt-5", { effortLevels: ["low", "medium", "high"], fastMode: true }), model("gpt-plain")];
  assert.deepEqual(threadSettingsOptions(modelExecutionControls("codex", "gpt-5", models), ["ask", "auto", "full"]), { reasoning: true, tier: true, access: true });
  assert.deepEqual(threadSettingsOptions(modelExecutionControls("codex", "gpt-plain", models), ["ask"]), { reasoning: false, tier: false, access: true });
  // Fast is a Codex and Claude adapter option: another provider's flag does not show the row.
  assert.equal(threadSettingsOptions(modelExecutionControls("opencode", "gpt-5", models), []).tier, false);
  assert.deepEqual(threadSettingsOptions(modelExecutionControls("codex", null, models), []), { reasoning: false, tier: false, access: false });
});

test("the summary card names the pending model and notes default or agent switch", () => {
  const settings = { defaultModel: "claude::claude-opus-5-5" };
  const models = [model("claude-opus-5-5", { displayName: "Claude Opus 5.5" })];
  assert.deepEqual(threadSettingsSummary(settings, models, "claude", "claude-opus-5-5", "claude"), { name: "Opus 5.5", note: "default" });
  assert.deepEqual(threadSettingsSummary(settings, models, "claude", "claude-opus-5-5", "codex"), { name: "Opus 5.5", note: "switch" });
  // A new conversation has no agent to switch from; an id missing from the catalog still reads well.
  assert.deepEqual(threadSettingsSummary(settings, [], "claude", "claude-haiku-4-5-20251001", null), { name: "Haiku 4.5", note: null });
  assert.deepEqual(threadSettingsSummary(settings, models, "claude", null, "claude"), { name: null, note: null });
});

test("the model search filters across every enabled provider", () => {
  const catalogs: Partial<Record<"codex" | "claude", ProviderModelList>> = {
    codex: { provider: "codex", source: "", note: "", models: [model("gpt-5.5", { displayName: "GPT-5.5" }), model("gpt-5.5-mini", { displayName: "GPT-5.5 mini" })] },
    claude: { provider: "claude", source: "", note: "", models: [model("claude-opus-5-5", { displayName: "Claude Opus 5.5" })] },
  };
  const settings = { ...defaultSettings, favoriteModels: [] };
  assert.deepEqual(threadSettingsSections(catalogs, settings, ["claude", "codex"], "claude", null, "5.5").map((section) => [section.provider, section.rows.length]), [["claude", 1], ["codex", 2]]);
  assert.deepEqual(threadSettingsSections(catalogs, settings, ["claude", "codex"], "claude", null, "mini").map((section) => [section.provider, section.rows.map((row) => row.model.id)]), [["codex", ["gpt-5.5-mini"]]]);
  // A provider left out (disabled or not installed) never shows, even when its models match.
  assert.deepEqual(threadSettingsSections(catalogs, settings, ["claude"], "claude", null, "gpt").map((section) => section.provider), []);
});

test("the Git menu reads clean, changed and whether Commit has work", () => {
  assert.deepEqual(gitMenuSummary(null), { changed: 0, clean: false, canCommit: false });
  assert.deepEqual(gitMenuSummary({ changes: [], dirty: false, ahead: 0, behind: 0 }), { changed: 0, clean: true, canCommit: false });
  const changes = [{}, {}, {}] as never[];
  assert.deepEqual(gitMenuSummary({ changes, dirty: true, ahead: 0, behind: 0 }), { changed: 3, clean: false, canCommit: true });
});

test("terminal rows span panes in number order and mark running shells", () => {
  const workspace = { panes: [{ id: "a", terminals: [{ id: "t2", number: 2 }] }, { id: "b", terminals: [{ id: "t1", number: 1 }] }] };
  assert.deepEqual(terminalRows(workspace, ["t2"]), [{ paneId: "b", terminalId: "t1", number: 1, running: false }, { paneId: "a", terminalId: "t2", number: 2, running: true }]);
  assert.deepEqual(terminalRows(undefined), []);
});

test("the Files tree opens folders in place", () => {
  const entry = (path: string, isDir = false): FileEntry => ({ name: path.split("/").at(-1)!, path, isDir });
  const root = [entry("/w/src", true), entry("/w/README.md")];
  const children = { "/w/src": [entry("/w/src/lib", true), entry("/w/src/main.ts")], "/w/src/lib": [entry("/w/src/lib/a.ts")] };
  assert.deepEqual(visibleTreeRows(root, children, new Set()).map((row) => row.entry.path), ["/w/src", "/w/README.md"]);
  const open = visibleTreeRows(root, children, new Set(["/w/src", "/w/src/lib"]));
  assert.deepEqual(open.map((row) => [row.entry.name, row.depth]), [["src", 0], ["lib", 1], ["a.ts", 2], ["main.ts", 1], ["README.md", 0]]);
  // A folder still loading shows open with nothing under it yet.
  assert.deepEqual(visibleTreeRows(root, {}, new Set(["/w/src"])).map((row) => row.expanded), [true, false]);
});

test("search results resolve under the workspace root", () => {
  assert.equal(workspacePath("/w/", "src/a.ts"), "/w/src/a.ts");
  assert.equal(workspacePath("/w", "./src"), "/w/src");
  assert.equal(workspacePath("/w", "/abs/x"), "/abs/x");
});
