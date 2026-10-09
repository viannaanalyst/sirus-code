import test from "node:test";
import assert from "node:assert/strict";
import { composerOwnsTyping, typingGoesToComposer, TYPING_OWNER_SELECTOR } from "../src/lib/type-to-focus.ts";

/** A focused element inside `ancestors` (innermost first), each named by tag, role or class. */
function element(...ancestors: { tag?: string; role?: string; className?: string; editable?: boolean }[]) {
  const selectors = TYPING_OWNER_SELECTOR.split(",").map((part) => part.trim());
  return {
    isContentEditable: ancestors[0]?.editable ?? false,
    closest(selector: string) {
      assert.equal(selector, TYPING_OWNER_SELECTOR);
      return ancestors.find((node) => selectors.some((part) =>
        part === node.tag || part === `[role=${node.role}]` || part === `.${node.className}`)) ?? null;
    },
  };
}
const key = (value: string, extra: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; isComposing: boolean; defaultPrevented: boolean }> = {}) =>
  ({ key: value, metaKey: false, ctrlKey: false, altKey: false, ...extra });

test("printable keys move to the composer from the page or a non-interactive container", () => {
  const body = element({ tag: "body" });
  assert.equal(typingGoesToComposer(key("a"), null), true);
  assert.equal(typingGoesToComposer(key("a"), body, body), true);
  assert.equal(typingGoesToComposer(key(" "), element({ tag: "article" }, { tag: "section" })), true, "the transcript article is not a control");
  assert.equal(typingGoesToComposer(key("x"), element({ tag: "div" }, { tag: "article" })), true);
});

test("focused controls keep Space and letters", () => {
  for (const focused of [
    element({ tag: "button" }), element({ tag: "a" }), element({ tag: "summary" }), element({ tag: "details" }),
    element({ tag: "input" }), element({ tag: "textarea" }), element({ tag: "select" }), element({ tag: "div", editable: true }),
    ...["switch", "checkbox", "tab", "menuitem", "option", "treeitem", "slider", "radio", "dialog", "listbox"].map((role) => element({ tag: "div", role })),
    element({ tag: "span" }, { tag: "div", role: "treeitem" }, { tag: "div", role: "tree" }),
    element({ tag: "textarea" }, { tag: "div", className: "xterm" }),
  ]) {
    assert.equal(typingGoesToComposer(key(" "), focused), false);
    assert.equal(typingGoesToComposer(key("f"), focused), false);
  }
});

test("shortcuts, composition, handled events and non-printable keys are left alone", () => {
  for (const event of [key("a", { metaKey: true }), key("a", { ctrlKey: true }), key("a", { altKey: true }), key("a", { isComposing: true }), key("a", { defaultPrevented: true }), key("Enter"), key("ArrowUp"), key("Tab")]) {
    assert.equal(typingGoesToComposer(event, null), false);
  }
});

test("only the visible main composer of the selection owns redirected typing", () => {
  assert.equal(composerOwnsTyping({ sessionId: "s", sideChat: false, visible: true }, "s"), true);
  assert.equal(composerOwnsTyping({ sessionId: null, sideChat: false, visible: true }, null), true, "the landing composer");
  assert.equal(composerOwnsTyping({ sessionId: "side", sideChat: true, visible: true }, "side"), false, "side chats never take keys");
  assert.equal(composerOwnsTyping({ sessionId: "other", sideChat: false, visible: true }, "s"), false, "a split pane beside the active one");
  assert.equal(composerOwnsTyping({ sessionId: "s", sideChat: false, visible: false }, "s"), false, "a hidden composer");
});
