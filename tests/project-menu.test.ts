import assert from "node:assert/strict";
import { test } from "node:test";
import { PROJECT_MENU_GROUP, projectMenuEntries } from "../src/lib/project-menu.ts";

const folder = (id: string, projectIds: string[]) => ({ id, name: id, look: {}, projectIds, collapsed: false });

test("a project outside folders offers every folder, then a new one", () => {
  const entries = projectMenuEntries("a", [folder("work", ["b"]), folder("play", [])]);
  assert.deepEqual(entries.map(entry => "folder" in entry ? `${entry.kind}:${entry.folder.id}` : entry.kind),
    ["new", "edit", "move:work", "move:play", "new-folder", "reveal", "copy-path", "remove"]);
});

test("a project in a folder can leave it and move to the others only", () => {
  const entries = projectMenuEntries("a", [folder("work", ["a"]), folder("play", [])]);
  assert.deepEqual(entries.map(entry => "folder" in entry ? `${entry.kind}:${entry.folder.id}` : entry.kind),
    ["new", "edit", "move:play", "out:work", "new-folder", "reveal", "copy-path", "remove"]);
});

test("groups follow the menu's order, so each separator falls between two groups", () => {
  const groups = projectMenuEntries("a", [folder("work", ["a"]), folder("play", [])]).map(entry => PROJECT_MENU_GROUP[entry.kind]);
  assert.deepEqual(groups.filter((group, index) => group !== groups[index - 1]), ["new", "edit", "folders", "path", "danger"]);
});
