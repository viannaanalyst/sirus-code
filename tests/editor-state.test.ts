import assert from "node:assert/strict";
import { test } from "node:test";
import { acknowledgeEditorSave, editorKey } from "../src/lib/editor-state";
import { configureDynamicStyleNonce, editorStyleNonce } from "../src/lib/editor-nonce";
import { getNonce, setNonce } from "get-nonce";

test("a completed Save retains edits typed after its snapshot", () => {
  const buffer = { content: "typed during save", saved: "old disk", marker: 42 };
  const result = acknowledgeEditorSave(buffer, "sent snapshot");
  assert.equal(result.content, buffer.content);
  assert.equal(result.saved, "sent snapshot");
  assert.notEqual(result.content, result.saved);
  assert.equal(result.marker, 42);
  assert.equal(buffer.saved, "old disk");
});

test("CodeMirror receives the nonce property even when browsers hide the attribute", () => {
  const style = { nonce: "native-style-authorization", getAttribute: () => "" };
  const head = { querySelector: (selector: string) => {
    assert.equal(selector, "style[nonce]");
    return style;
  } } as unknown as Document["head"];
  assert.equal(editorStyleNonce({ head }), "native-style-authorization");
  configureDynamicStyleNonce({ head });
  assert.equal(getNonce(), "native-style-authorization", "The existing Radix scroll guard receives the same authorization");
  setNonce("");
  assert.equal(editorStyleNonce({ head: { querySelector: () => null } as unknown as Document["head"] }), undefined);
});

test("same path in different sessions keeps separate editor buffers", () => {
  assert.notEqual(editorKey("session-a", "README.md"), editorKey("session-b", "README.md"));
});
