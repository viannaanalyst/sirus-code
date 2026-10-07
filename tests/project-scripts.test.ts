import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDiskSize, visibleScriptRun, worktreeReleaseText } from "../src/lib/project-scripts.ts";
import { mergeSettings } from "../src/lib/settings.ts";
import { projectScriptsEnglish, projectScriptsPortuguese } from "../src/i18n/project-scripts-strings.ts";
import type { ScriptRun } from "../src/client/types.ts";

const run = (id: string, status: ScriptRun["status"], startedAt: string): ScriptRun => ({ id, kind: id === "s" ? "setup" : "finish", status, startedAt, output: "" });

test("a running script shows first, else the latest run", () => {
  assert.equal(visibleScriptRun(null), null);
  assert.equal(visibleScriptRun({ scripts: { setupPending: true } }), null);
  assert.equal(visibleScriptRun({ scripts: { runs: [run("s", "failed", "2026-10-07T10:00:00Z"), run("f", "succeeded", "2026-10-07T11:00:00Z")] } })?.id, "f");
  assert.equal(visibleScriptRun({ scripts: { runs: [run("s", "running", "2026-10-07T10:00:00Z"), run("f", "failed", "2026-10-07T11:00:00Z")] } })?.id, "s");
});

test("disk sizes use binary units", () => {
  assert.equal(formatDiskSize(0), "0 B");
  assert.equal(formatDiskSize(1536), "1.5 KB");
  assert.equal(formatDiskSize(250 * 1024 * 1024), "250 MB");
  assert.equal(formatDiskSize(3.2 * 1024 ** 3), "3.2 GB");
});

test("archive release outcomes map to localized reasons", () => {
  assert.deepEqual(worktreeReleaseText({ outcome: "released", branch: "sirus/a" }), { title: "worktreeRelease.released", description: "worktreeRelease.releasedHelp", values: { branch: "sirus/a" } });
  const kept = worktreeReleaseText({ outcome: "kept", reason: "unmerged", branch: "sirus/a" });
  assert.equal(kept.description, "worktreeRelease.unmerged");
  for (const reason of ["uncommitted", "unmerged", "unverified", "inUse", "running", "failed"]) {
    assert.ok(projectScriptsEnglish[`worktreeRelease.${reason}`], reason);
    assert.ok(projectScriptsPortuguese[`worktreeRelease.${reason}`], reason);
  }
});

test("releasing worktrees on archive is opt-in", () => {
  assert.equal(mergeSettings(null).releaseWorktreeOnArchive, false);
  assert.equal(mergeSettings({ releaseWorktreeOnArchive: true }).releaseWorktreeOnArchive, true);
});
