import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseDefaultProvider, defaultSettings, mergeSettings, resetGeneralSettings } from "../src/lib/settings.ts";

test("legacy settings retain visible Environment sections and safe ordering modes", () => {
  const legacy = mergeSettings({});
  assert.equal(legacy.sidebarProjectSortOrder, "manual");
  assert.equal(legacy.sidebarThreadSortOrder, "created_at");
  assert.ok(legacy.showEnvironmentUsage && legacy.showEnvironmentRepository && legacy.showEnvironmentEditor);
  assert.ok(legacy.showEnvironmentPinned && legacy.showEnvironmentNotepad && legacy.showEnvironmentInstructions);
  const invalid = mergeSettings({ sidebarProjectSortOrder: "invalid", sidebarThreadSortOrder: null } as never);
  assert.equal(invalid.sidebarProjectSortOrder, "manual");
  assert.equal(invalid.sidebarThreadSortOrder, "created_at");
  const off = mergeSettings({ showEnvironmentUsage: false, showEnvironmentRepository: false, showEnvironmentEditor: false });
  assert.equal(off.showEnvironmentUsage, false);
  assert.equal(off.showEnvironmentRepository, false);
  assert.equal(off.showEnvironmentEditor, false);
  for (const key of ["showEnvironmentPinned", "showEnvironmentNotepad", "showEnvironmentInstructions"] as const) {
    const settings = mergeSettings({ [key]: false });
    assert.equal(settings[key], false);
    assert.equal(resetGeneralSettings(settings)[key], true);
  }
});

test("default-provider changes retain compatible models and clear only foreign model defaults", () => {
  const settings = mergeSettings({ defaultAgent: "codex", defaultModel: "codex::model", showEnvironmentEditor: false, pinnedSessionIds: ["one"] });
  assert.deepEqual(chooseDefaultProvider(settings, "codex"), settings);
  assert.deepEqual(chooseDefaultProvider(settings, "claude"), { ...settings, defaultAgent: "claude", defaultModel: null });
  const matching = { ...settings, defaultAgent: "claude" as const, defaultModel: "codex::model" };
  assert.equal(chooseDefaultProvider(matching, "codex").defaultModel, "codex::model");
  assert.equal(settings.defaultModel, "codex::model");
});

test("General page reset restores its preferences without resetting other pages or owned metadata", () => {
  const settings = mergeSettings({ defaultAgent: "claude", defaultModel: "claude::model", locale: "en", defaultSessionWorkspace: "worktree", openLastProject: false,
    showEnvironmentUsage: false, showEnvironmentEditor: false, showEnvironmentNotepad: false, showEnvironmentInstructions: false,
    sidebarProjectSortOrder: "created_at", sidebarThreadSortOrder: "updated_at", sidebarProjectOrder: ["b", "a"],
    pinnedSessionIds: ["s"], archivedSessionIds: ["archived"], composerLineSpeed: "fast", uiFontSize: 14, disabledProviders: ["grok"] });
  const original = structuredClone(settings);
  const restored = resetGeneralSettings(settings);
  assert.equal(restored.defaultAgent, "codex");
  assert.equal(restored.defaultModel, null, "a foreign provider model cannot remain the default");
  assert.equal(restored.locale, defaultSettings.locale);
  assert.equal(restored.defaultSessionWorkspace, defaultSettings.defaultSessionWorkspace);
  assert.equal(restored.openLastProject, defaultSettings.openLastProject);
  assert.equal(restored.sidebarProjectSortOrder, defaultSettings.sidebarProjectSortOrder);
  assert.equal(restored.sidebarThreadSortOrder, defaultSettings.sidebarThreadSortOrder);
  assert.ok(restored.showEnvironmentUsage && restored.showEnvironmentEditor && restored.showEnvironmentNotepad && restored.showEnvironmentInstructions);
  assert.equal(restored.composerLineSpeed, "fast");
  assert.equal(restored.uiFontSize, 14);
  assert.deepEqual(restored.disabledProviders, ["grok"]);
  assert.deepEqual(restored.pinnedSessionIds, ["s"]);
  assert.deepEqual(restored.archivedSessionIds, ["archived"]);
  assert.deepEqual(restored.sidebarProjectOrder, ["b", "a"]);
  assert.deepEqual(settings, original, "reset does not mutate the currently saved settings");
  assert.deepEqual(settings.sidebarProjectOrder, ["b", "a"]);
  assert.equal(resetGeneralSettings(mergeSettings({ defaultModel: "codex::chosen-model" })).defaultModel, "codex::chosen-model", "a compatible Models preference remains intact");
});
