import test from "node:test";
import assert from "node:assert/strict";
import { CLOSED_ITEMS_LIMIT, insertAt, popClosed, pushClosed, rememberBrowserTab, type ClosedItem } from "../src/lib/closed-items.ts";

const tab = (sessionId: string, index = 0): ClosedItem => ({ kind: "session", projectId: "p", sessionId, index });
const pane = (id: string): ClosedItem => ({ kind: "dock", pane: { id, kind: "terminal" }, index: 1 });
const page = (url: string): ClosedItem => ({ kind: "browser", sessionId: "s", url, title: "" });

test("one bounded stack keeps the most recent closed things", () => {
  let stack: ClosedItem[] = [];
  for (let index = 0; index < CLOSED_ITEMS_LIMIT + 5; index++) stack = pushClosed(stack, [tab(`s${index}`)]);
  assert.equal(stack.length, CLOSED_ITEMS_LIMIT);
  assert.deepEqual(stack.at(-1), tab(`s${CLOSED_ITEMS_LIMIT + 4}`));
  assert.deepEqual(stack[0], tab("s5"), "the oldest fall off");
});

test("reopen restores the most recent thing of any kind and skips stale entries", () => {
  const stack = [tab("a"), pane("terminal"), page("https://example.com"), tab("gone")];
  const first = popClosed(stack, (item) => !(item.kind === "session" && item.sessionId === "gone"));
  assert.deepEqual(first.item, page("https://example.com"), "the deleted session's tab is skipped");
  assert.deepEqual(first.rest, [tab("a"), pane("terminal")], "stale entries above it are dropped");
  const second = popClosed(first.rest, () => true);
  assert.deepEqual(second.item, pane("terminal"));
  assert.deepEqual(popClosed([], () => true), { item: null, rest: [] });
});

test("the tab menu's reopen takes only header tabs and leaves panes in the stack", () => {
  const { item, rest } = popClosed([tab("a"), pane("files"), page("https://example.com")], () => true, "session");
  assert.deepEqual(item, tab("a"));
  assert.deepEqual(rest, [pane("files"), page("https://example.com")]);
});

test("reopened tabs go back near their old position; blank pages are not remembered", () => {
  assert.deepEqual(insertAt(["a", "c"], "b", 1), ["a", "b", "c"]);
  assert.deepEqual(insertAt(["a"], "b", 9), ["a", "b"]);
  assert.deepEqual(insertAt(["a"], "b", -3), ["b", "a"]);
  assert.equal(rememberBrowserTab("https://example.com"), true);
  assert.equal(rememberBrowserTab("http://localhost:5173"), true);
  for (const url of ["", "about:blank", "sirus-preview://localhost/x"]) assert.equal(rememberBrowserTab(url), false, url);
});
