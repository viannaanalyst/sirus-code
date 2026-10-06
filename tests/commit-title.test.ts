import assert from "node:assert/strict";
import { test } from "node:test";
import { CommitTitleRequest, type CommitTitleApi } from "../src/lib/commit-title";
import { SirusClient } from "../src/client/index";
import type { CommitTitleResult } from "../src/client/types";
import type { Transport } from "../src/client/transport";

const title: CommitTitleResult = { type: "title", title: "Prevent duplicate login requests", provider: "codex", partial: false };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const result = deferred<CommitTitleResult | null>();
  const cancellations: string[][] = [];
  const calls: string[][] = [];
  const api: CommitTitleApi = {
    gitCommitTitle(session, index, request) { calls.push([session, index, request]); return result.promise; },
    async cancelCommitTitle(session, request) { cancellations.push([session, request]); },
  };
  const owner = { sessionId: "owner", index: "prepared", revision: 0, alive: true };
  const request = new CommitTitleRequest(api, "owner", "prepared", "request", 0);
  return { result, owner, request, cancellations, calls };
}

test("generation uses captured native index and publishes provider/partial", async () => {
  const f = fixture();
  const pending = f.request.generate(() => f.owner);
  assert.deepEqual(f.calls, [["owner", "prepared", "request"]]);
  f.result.resolve({ ...title, provider: "claude", partial: true });
  assert.deepEqual(await pending, { type: "title", result: { ...title, provider: "claude", partial: true } });
});
test("typing during pending generation preserves the edited title", async () => {
  const f = fixture();
  const pending = f.request.generate(() => f.owner);
  f.owner.revision++;
  f.result.resolve(title);
  assert.deepEqual(await pending, { type: "discarded" });
});
test("Cancel acknowledgement cannot settle generation or admit a late result", async () => {
  const f = fixture();
  let settled = false;
  const pending = f.request.generate(() => f.owner).then(value => { settled = true; return value; });
  await f.request.cancel(); await f.request.cancel();
  assert.equal(settled, false);
  assert.deepEqual(f.cancellations, [["owner", "request"]]);
  f.result.resolve(title);
  assert.deepEqual(await pending, { type: "cancelled" });
});
for (const scenario of ["unmount", "session", "index", "revision"] as const) {
  for (const error of [false, true]) test(`${scenario} rejects late ${error ? "errors" : "results"}`, async () => {
    const f = fixture();
    const pending = f.request.generate(() => f.owner);
    if (scenario === "unmount") { f.owner.alive = false; await f.request.cancel(); }
    else if (scenario === "session") f.owner.sessionId = "other";
    else if (scenario === "index") f.owner.index = "new-index";
    else f.owner.revision++;
    if (error) f.result.reject(new Error("late")); else f.result.resolve(title);
    assert.notEqual((await pending).type, error ? "error" : "title");
  });
}
test("cancellation suppresses a late provider error", async () => {
  const f = fixture(); const pending = f.request.generate(() => f.owner);
  await f.request.cancel(); f.result.reject(new Error("late provider failure"));
  assert.deepEqual(await pending, { type: "cancelled" });
});
test("native cancellation and eligible errors are visible outcomes", async () => {
  const f = fixture(); const pending = f.request.generate(() => f.owner);
  f.result.resolve(null); assert.deepEqual(await pending, { type: "cancelled" });
  const g = fixture(); const next = g.request.generate(() => g.owner);
  const reason = new Error("provider unavailable"); g.result.reject(reason);
  assert.deepEqual(await next, { type: "error", reason });
});
function transport(response: unknown, calls: { command: string; args?: Record<string, unknown> }[]): Transport {
  return { async invoke<T>(command: string, args?: Record<string, unknown>) { calls.push({ command, args }); return response as T; }, async listen() { return () => {}; } };
}
test("client uses only closed generate/cancel actions and maps cancellation to null", async () => {
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  const client = new SirusClient(transport(title, calls));
  assert.deepEqual(await client.gitCommitTitle("session", "token", "uuid"), title);
  assert.deepEqual(calls[0], { command: "commit_title_action", args: { action: { type: "generate", sessionId: "session", expectedIndex: "token", requestId: "uuid" } } });
  const cancelled = new SirusClient(transport({ type: "cancelled" }, calls));
  assert.equal(await cancelled.gitCommitTitle("session", "token", "uuid"), null);
  await cancelled.cancelCommitTitle("session", "uuid");
  assert.deepEqual(calls.at(-1), { command: "commit_title_action", args: { action: { type: "cancel", sessionId: "session", requestId: "uuid" } } });
});
test("client refuses open, invalid, multiline and wrong-provider replies", async () => {
  for (const response of [null, {}, { type: "cancelled", extra: true }, { ...title, extra: true }, { ...title, title: "" }, { ...title, title: " padded " }, { ...title, title: "line\nline" }, { ...title, title: "x".repeat(73) }, { ...title, provider: "cursor" }, { ...title, partial: "false" }]) {
    const client = new SirusClient(transport(response, []));
    await assert.rejects(client.gitCommitTitle("session", "token", "uuid"));
  }
  await assert.rejects(new SirusClient(transport(title, [])).cancelCommitTitle("session", "uuid"));
});
