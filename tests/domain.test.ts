import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, mergeSettings, modelKey, parseModelKey } from "../src/lib/settings.ts";
import { translate } from "../src/i18n/index.ts";
import { PROVIDERS } from "../src/lib/provider-registry.ts";
import { formatUnknownError } from "../src/lib/format-error.ts";
import { queueTerminalOperation } from "../src/lib/terminal-lifecycle.ts";

test("model keys preserve provider identity and reject unknown providers", () => {
  assert.deepEqual(parseModelKey("cursor::claude-sonnet"), { provider: "cursor", id: "claude-sonnet" });
  assert.equal(parseModelKey("unknown::model"), null);
  assert.notEqual(modelKey("cursor", "same"), modelKey("claude", "same"));
});
test("legacy settings get safe defaults and permanent Git confirmation", () => {
  const settings = mergeSettings({ gitConfirmDestructive: false, locale: "en" });
  assert.equal(settings.gitConfirmDestructive, true);
  assert.deepEqual(settings.favoriteModels, []);
  assert.equal(mergeSettings(null).locale, "pt-BR");
});
test("composer line speed restores old preferences and recovers invalid values", () => {
  assert.equal(mergeSettings({}).composerLineSpeed, "slow");
  for (const speed of ["slow", "smooth", "fast"] as const) {
    assert.equal(mergeSettings({ composerLineSpeed: speed }).composerLineSpeed, speed);
  }
  for (const speed of [null, "turbo", 10]) {
    assert.equal(mergeSettings({ composerLineSpeed: speed as typeof defaultSettings.composerLineSpeed }).composerLineSpeed, "slow");
  }
});
test("localization preserves external parameters and provides English fallback", () => {
  assert.equal(translate("pt-BR", "session.workOn", { project: "repo--main" }), "Em que vamos trabalhar em repo--main?");
  assert.equal(translate("en", "General"), "General");
  assert.equal(translate("pt-BR", "General"), "Geral");
  assert.equal(translate("en", "no.such.key"), "no.such.key");
});
test("provider registry has nine unique identities", () => {
  assert.deepEqual(PROVIDERS.map((item) => item.id).sort(), ["antigravity", "claude", "codex", "cursor", "devin", "droid", "grok", "opencode", "pi"]);
});
test("structured IPC errors remain readable", () => {
  assert.equal(formatUnknownError({ code: "git", message: "dirty worktree" }), "git: dirty worktree");
  assert.equal(formatUnknownError({ token: "must not appear in a toast" }), "Unknown error");
});
test("terminal restart follows pending start and cleanup even after a failed operation", async () => {
  const order: string[] = [];
  const first = queueTerminalOperation("test-session", async () => { await new Promise((resolve) => setTimeout(resolve, 5)); order.push("start"); });
  const stop = queueTerminalOperation("test-session", async () => { order.push("stop"); throw new Error("fixture failure"); });
  const reopen = queueTerminalOperation("test-session", async () => { order.push("reopen"); });
  await first;
  await assert.rejects(stop);
  await reopen;
  assert.deepEqual(order, ["start", "stop", "reopen"]);
});


test("UI font preferences recover invalid persisted sizes without altering terminal size", () => {
  for (const size of [0, 10, 19, -1, 12.5, NaN, Infinity]) {
    const settings = mergeSettings({ uiFontSize: size, terminalFontSize: 17 });
    assert.equal(settings.uiFontSize, 13);
    assert.equal(settings.terminalFontSize, 17);
  }
  for (const size of [11, 12, 13, 14, 16, 18]) assert.equal(mergeSettings({ uiFontSize: size }).uiFontSize, size);
});
