import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultSettings, mergeSettings } from "../src/lib/settings.ts";
import { applyLookChange, createFolder, deleteFolder, folderOf, moveProjectToFolder, switcherEntries, updateFolder } from "../src/lib/project-folders.ts";

const projects = [{ id: "a" }, { id: "b" }, { id: "c" }];

test("folders group projects, one folder each, and deleting a folder keeps its projects", () => {
  let settings = createFolder(defaultSettings, "f", "  InChurch ");
  settings = createFolder(settings, "g", "Pessoal");
  assert.equal(createFolder(settings, "x", "   "), settings);
  assert.equal(settings.projectFolders[0].name, "InChurch");
  settings = moveProjectToFolder(settings, "a", "f");
  settings = moveProjectToFolder(settings, "c", "f");
  settings = moveProjectToFolder(settings, "a", "g");
  assert.deepEqual(settings.projectFolders.map((folder) => folder.projectIds), [["c"], ["a"]]);
  assert.equal(folderOf(settings, "a")?.id, "g");
  settings = moveProjectToFolder(settings, "a", null);
  assert.equal(folderOf(settings, "a"), undefined);
  settings = updateFolder(settings, "f", { name: "", collapsed: true });
  assert.equal(settings.projectFolders[0].name, "InChurch");
  settings = deleteFolder(settings, "f");
  assert.deepEqual(settings.projectFolders.map((folder) => folder.id), ["g"]);
});

test("switcher lists folders with their projects in switcher order, then loose projects; search opens folders", () => {
  let settings = createFolder(defaultSettings, "f", "InChurch");
  settings = moveProjectToFolder(settings, "c", "f");
  settings = moveProjectToFolder(settings, "a", "f");
  const kinds = (entries: ReturnType<typeof switcherEntries>) => entries.map((entry) => entry.kind === "folder" ? `folder:${entry.count}` : entry.project.id);
  assert.deepEqual(kinds(switcherEntries(projects, settings.projectFolders, false)), ["folder:2", "a", "c", "b"]);
  const collapsed = updateFolder(settings, "f", { collapsed: true }).projectFolders;
  assert.deepEqual(kinds(switcherEntries(projects, collapsed, false)), ["folder:2", "b"]);
  assert.deepEqual(kinds(switcherEntries([{ id: "a" }], collapsed, true)), ["folder:1", "a"]);
  assert.deepEqual(kinds(switcherEntries([{ id: "b" }], collapsed, true)), ["b"]);
});

test("a folder keeps one icon at a time and its colour", () => {
  const look = applyLookChange({ color: "blue", emoji: "🚀" }, { kind: "icon", icon: "rocket" });
  assert.deepEqual(look, { color: "blue", icon: "rocket" });
  assert.deepEqual(applyLookChange(look, { kind: "logo", logo: "data:image/png;base64,AA" }), { color: "blue", logo: "data:image/png;base64,AA" });
  assert.deepEqual(applyLookChange(look, { kind: "clear" }), { color: "blue" });
});

test("saved folders are bounded and cleaned when settings load", () => {
  const merged = mergeSettings({ projectFolders: [{ id: "f", name: "A", look: {}, projectIds: ["a", "a", ""], collapsed: true }, { id: "", name: "x" }, { id: "g", name: "  " }] } as never);
  assert.deepEqual(merged.projectFolders, [{ id: "f", name: "A", look: {}, projectIds: ["a"], collapsed: true }]);
});
