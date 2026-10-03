import { test } from "node:test";
import assert from "node:assert/strict";
import { appendDiffComment, reviewDiffLines } from "../src/lib/diff-comment.ts";
import { useAppStore } from "../src/store/app-store.ts";
import { client } from "../src/client/index.ts";
import type { Session } from "../src/client/types.ts";

const diff = "--- a/src/login.ts\n+++ b/src/login.ts\n@@ -10,2 +10,2 @@\n const user = read();\n-return user;\n+return user ?? null;\n";
test("diff comments preserve the draft and quote exact historical lines with old/new coordinates", () => {
  assert.equal(appendDiffComment("Minha pergunta", "src/login.ts", diff, 4, 5, "Trate o erro também."), 'Minha pergunta\n\n> Review of "src/login.ts" (old: 11; new: 11)\n> -return user;\n> +return user ?? null;\n\nTrate o erro também.\n\n');
  assert.equal(appendDiffComment("", "src/login.ts", diff, 0, 2, "Comentário"), null);
  for (const [from, to] of [[-1, 2], [5, 4], [4, 99]]) assert.equal(appendDiffComment("", "file", diff, from, to, "Comentário"), null);
  assert.equal(appendDiffComment("", "file", diff, 4, 5, " "), null);
  assert.equal(appendDiffComment("x".repeat(65500), "file", diff, 4, 5, "🙂".repeat(20)), null);
});
test("untracked snapshots expose real source line numbers and escape path/text as plain draft data", () => {
  const source = "+++ untracked\n<script>\n/skill\n";
  assert.deepEqual(reviewDiffLines(source).map(line => [line.content, line.oldLine, line.newLine]), [["+<script>", null, 1], ["+/skill", null, 2]]);
  assert.equal(appendDiffComment("", "a\nfile.ts", source, 1, 1, "Revise"), '> Review of "a\\nfile.ts" (old: —; new: 2)\n> +/skill\n\nRevise\n\n');
});

test("adding review feedback rejects stale snapshots, foreign sessions and expired diffs without sending", async context => {
  context.mock.method(client, "saveComposerDraft", async () => undefined);
  let sends = 0;
  context.mock.method(client, "sendPrompt", async () => { sends++; throw new Error("Must not send"); });
  const session = { id: "s", projectId: "p", title: "Fixture", messages: [{ id: "m", sessionId: "s", role: "agent", content: "Done", streaming: false, activity: { endedAt: 1, review: { expired: false, files: [{ path: "src/login.ts", diff, binary: false }] } } }] } as Session;
  useAppStore.setState({ projects: [{ id: "p", name: "Fixture", path: "/fixture", addedAt: "time", lastOpenedAt: "time" }], sessions: [session], selectedSessionId: "s", selectedProjectId: "p", mainView: "session", settingsOpen: false, paletteOpen: false, newSessionOpen: false, composerDrafts: { "session:s": "Original", "session:other": "Other" } });
  const selection = { path: "src/login.ts", diff, from: 4, to: 5, comment: "Trate o erro" };
  const state = () => useAppStore.getState();
  assert.equal(state().addReviewComment("other", "m", selection), false);
  assert.equal(state().addReviewComment("s", "missing", selection), false);
  assert.equal(state().addReviewComment("s", "m", { ...selection, diff: diff + "+unrelated" }), false);
  useAppStore.setState({ selectedProjectId: "other" });
  assert.equal(state().addReviewComment("s", "m", selection), false);
  useAppStore.setState({ selectedProjectId: "p" });
  session.messages[0].activity!.review!.expired = true;
  assert.equal(state().addReviewComment("s", "m", selection), false);
  assert.equal(state().composerDrafts["session:s"], "Original");
  session.messages[0].activity!.review!.expired = false;
  assert.equal(state().addReviewComment("s", "m", selection), true);
  assert.match(state().composerDrafts["session:s"], /^Original\n\n> Review of/);
  assert.match(state().composerDrafts["session:s"], /Trate o erro\n\n$/);
  assert.equal(state().composerDrafts["session:other"], "Other");
  assert.equal(sends, 0);
  await new Promise(resolve => setTimeout(resolve, 300));
});
