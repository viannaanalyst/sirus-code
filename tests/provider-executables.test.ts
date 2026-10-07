import { test } from "node:test";
import assert from "node:assert/strict";
import { executableChoices, withProviderPath } from "../src/lib/provider-executables.ts";
import { defaultSettings } from "../src/lib/settings.ts";
import type { AgentInstall } from "../src/client/types.ts";

const install: AgentInstall = { id: "claude", name: "Claude Code", binary: "claude", installed: true, path: "/opt/homebrew/bin/claude", version: "2.1.0",
  candidates: [{ path: "/opt/homebrew/bin/claude", version: "2.1.0" }, { path: "/Users/me/.claude/local/claude", version: "2.0.9" }] };

test("provider executables list every install and mark the one in use", () => {
  assert.deepEqual(executableChoices(install, undefined).map((row) => [row.path, row.current]), [["/opt/homebrew/bin/claude", true], ["/Users/me/.claude/local/claude", false]]);
  assert.deepEqual(executableChoices(install, "/Users/me/.claude/local/claude").map((row) => row.current), [false, true]);
  // A file chosen outside the searched folders is listed first.
  const picked = executableChoices({ ...install, path: "/tmp/tools/claude", version: "9.9" }, "/tmp/tools/claude");
  assert.deepEqual(picked[0], { path: "/tmp/tools/claude", version: "9.9", current: true });
  assert.equal(executableChoices(undefined, undefined).length, 0);
});

test("choosing an install writes the provider path override and automatic removes it", () => {
  const chosen = withProviderPath(defaultSettings, "claude", "/Users/me/.claude/local/claude");
  assert.equal(chosen.providerPaths.claude, "/Users/me/.claude/local/claude");
  assert.equal("claude" in withProviderPath(chosen, "claude", null).providerPaths, false);
  assert.deepEqual(defaultSettings.providerPaths, {});
});
