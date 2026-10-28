import { test } from "node:test";
import assert from "node:assert/strict";
import type { AppSettings } from "../src/client/types.ts";
import { composerApproval, defaultApprovalFor } from "../src/lib/composer-approval.ts";
import { mergeSettings } from "../src/lib/settings.ts";
import { finishedParagraphs, visibleReplyText } from "../src/lib/response-streaming.ts";
import { formatStorageSize, summarizeClientStorage } from "../src/lib/phone-storage.ts";

test("Old saved settings load with the new Mac settings at their defaults", () => {
  const old = mergeSettings({ theme: "light" } as Partial<AppSettings>);
  assert.equal(old.defaultApproval, "full");
  assert.equal(old.gitAutoPull, false);
  assert.equal(old.worktreesFromOrigin, true);
  assert.equal(old.responseStreaming, "token");
  assert.equal(old.agentBrowserAccess, true);
  const odd = mergeSettings({ defaultApproval: "root", responseStreaming: "fast", worktreesFromOrigin: false } as unknown as Partial<AppSettings>);
  assert.equal(odd.defaultApproval, "full");
  assert.equal(odd.responseStreaming, "token");
  assert.equal(odd.worktreesFromOrigin, false);
});

test("New conversations start on the default mode, stepping down when the provider lacks it", () => {
  assert.equal(defaultApprovalFor(["ask", "auto", "full"]), "full");
  assert.equal(defaultApprovalFor(["ask", "auto", "full"], "auto"), "auto");
  assert.equal(defaultApprovalFor(["auto"], "full"), "auto");
  assert.equal(defaultApprovalFor(["ask"], "auto"), "ask");
  assert.equal(defaultApprovalFor(["auto"], "ask"), "auto", "nothing safer: the provider's own mode");
  assert.equal(defaultApprovalFor([], "full"), "ask");
  assert.equal(composerApproval("codex", null, undefined, false, "ask").requested, "ask");
  assert.equal(composerApproval("codex", null, undefined, false).requested, "full");
  // A session keeps the mode it last used, and a choice in the composer wins.
  assert.equal(composerApproval("codex", { agent: "codex", execution: { approval: "full" } }, undefined, false, "ask").requested, "full");
  assert.equal(composerApproval("codex", null, { codex: "auto" }, false, "ask").requested, "auto");
});

test("Response streaming shows nothing, finished paragraphs, or every word while a reply streams", () => {
  const text = "First paragraph.\n\nSecond one is being wri";
  assert.equal(visibleReplyText(text, "token", true), text);
  assert.equal(visibleReplyText(text, "turn", true), "");
  assert.equal(visibleReplyText(text, "paragraph", true), "First paragraph.\n\n");
  for (const mode of ["turn", "paragraph", "token"] as const) assert.equal(visibleReplyText(text, mode, false), text);
  // A code block shows once its fence closes; blank lines inside it do not cut it.
  assert.equal(finishedParagraphs("Intro\n\n```ts\nconst a = 1;\n\nconst b"), "Intro\n\n");
  assert.equal(finishedParagraphs("Intro\n\n```ts\nconst a = 1;\n```\nAfter"), "Intro\n\n```ts\nconst a = 1;\n```\n");
  assert.equal(finishedParagraphs("~~~~\nx\n```\n~~~~\n"), "~~~~\nx\n```\n~~~~\n");
  assert.equal(finishedParagraphs("no break yet"), "");
});

test("Client storage counts what the phone keeps and never offers the pairing for clearing", () => {
  const items = new Map<string, string>([
    ["sirus.remote.token", "secret"],
    ["sirus.phone-prefs", "{\"theme\":\"light\"}"],
    ["sirus.outbox", "[{\"id\":\"a\"},{\"id\":\"b\"}]"],
    ["sirus.appearance", "{}"],
    ["other-app", "x"],
  ]);
  const keys = [...items.keys()];
  const storage = { getItem: (key: string) => items.get(key) ?? null, key: (index: number) => keys[index] ?? null, length: keys.length };
  assert.deepEqual(summarizeClientStorage(storage), { paired: true, prefsSet: true, outbox: 2, other: 1 });
  items.set("sirus.outbox", "{broken");
  items.set("sirus.phone-prefs", "{}");
  assert.deepEqual(summarizeClientStorage(storage), { paired: true, prefsSet: false, outbox: 0, other: 1 });
  assert.deepEqual([formatStorageSize(0), formatStorageSize(300), formatStorageSize(5 * 1024 * 1024)], ["0 KB", "1 KB", "5.0 MB"]);
});
