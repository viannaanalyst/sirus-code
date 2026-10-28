import test from "node:test";
import assert from "node:assert/strict";
import { mergeSettings, defaultSettings } from "../src/lib/settings.ts";
import { agentCueFor, isViewingNotice } from "../src/lib/agent-sounds.ts";

test("sounds are opt-in and persist as a boolean", () => {
  assert.equal(defaultSettings.agentSounds, false);
  assert.equal(mergeSettings({}).agentSounds, false);
  assert.equal(mergeSettings({ agentSounds: true }).agentSounds, true);
  assert.equal(mergeSettings({ agentSounds: "yes" as unknown as boolean }).agentSounds, false);
});

test("only finished turns and requests for the person make a cue", () => {
  assert.equal(agentCueFor("completion"), "completion");
  assert.equal(agentCueFor("permission"), "attention");
  assert.equal(agentCueFor("question"), "attention");
  assert.equal(agentCueFor("failure"), null);
  assert.equal(agentCueFor("reminder"), null);
  assert.equal(agentCueFor("pullRequest"), null);
});

test("the conversation in view stays silent only while the window is focused", () => {
  const view = { settingsOpen: false, mainView: "session", selectedSessionId: "s1" };
  const notice = { sessionId: "s1" };
  assert.equal(isViewingNotice(view, notice, true), true);
  assert.equal(isViewingNotice(view, notice, false), false);
  assert.equal(isViewingNotice(view, { sessionId: "s2" }, true), false);
  assert.equal(isViewingNotice({ ...view, settingsOpen: true }, notice, true), false);
  assert.equal(isViewingNotice({ ...view, mainView: "pulls" }, notice, true), false);
});
