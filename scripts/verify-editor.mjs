import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { editorExtensions, languageForPath } = await server.ssrLoadModule("/src/components/editor/CodeEditor.tsx");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const { client } = await server.ssrLoadModule("/src/client/index.ts");
  let saves = 0;
  for (const [path, doc, treeName] of [["page.tsx", "export const Home = () => <main>Hello</main>;", "Script"], ["guide.md", "# Hello\n\nManual **editing**.", "Document"]]) {
    const state = EditorState.create({ doc, extensions: editorExtensions({ language: languageForPath(path), nonce: "native-nonce", onChange() {}, onSave() { saves++; } }) });
    assert.equal(state.facet(EditorView.cspNonce), "native-nonce");
    assert.equal(state.facet(EditorView.editable), true);
    assert.equal(state.facet(EditorState.readOnly), false);
    assert.equal(syntaxTree(state).topNode.name, treeName);
    const save = state.facet(keymap).flat().find(binding => binding.key === "Mod-s");
    assert.ok(save?.preventDefault);
    assert.equal(save.run({ state }), true);
    assert.equal(state.update({ changes: { from: doc.length, insert: "\nnew text" } }).state.doc.toString(), `${doc}\nnew text`);
    // Wrapping is the reader's preference for every file, passed in by the pane.
    const wraps = (target) => target.facet(EditorView.contentAttributes).some(attrs => typeof attrs === "object" && attrs.class?.includes("cm-lineWrapping"));
    assert.equal(wraps(state), false);
    const wrapped = EditorState.create({ doc, extensions: editorExtensions({ language: languageForPath(path), onChange() {}, onSave() {}, wrap: EditorView.lineWrapping }) });
    assert.equal(wraps(wrapped), true);
  }
  assert.equal(saves, 2);
  assert.equal(languageForPath("guide.MDX"), "markdown");
  const originalWrite = client.writeTextFile;
  const writes = [];
  client.writeTextFile = (sessionId, path, content) => new Promise((resolve, reject) => writes.push({ sessionId, path, content, resolve, reject }));
  try {
    const key = "test-session:example.tsx";
    const store = () => useAppStore.getState();
    store().setEditorBuffer(key, "on disk", "on disk");
    store().setEditorBuffer(key, "save snapshot");
    const first = store().saveEditorBuffer("test-session", "example.tsx");
    assert.equal(store().editorSaving[key], true);
    store().setEditorBuffer(key, "typed after snapshot");
    await store().saveEditorBuffer("test-session", "example.tsx");
    assert.equal(writes.length, 1, "Different mounted views cannot admit concurrent writes to the same buffer");
    store().discardEditorBuffer(key);
    assert.equal(store().editorBuffers[key].content, "typed after snapshot", "A saving buffer cannot be discarded");
    writes[0].resolve(); await first;
    assert.equal(store().editorSaving[key], undefined);
    assert.equal(store().editorBuffers[key].content, "typed after snapshot");
    assert.equal(store().editorBuffers[key].saved, "save snapshot");
    const retry = store().saveEditorBuffer("test-session", "example.tsx");
    writes[1].reject(new Error("example save failure"));
    await assert.rejects(retry, /example save failure/);
    assert.equal(store().editorSaving[key], undefined);
    assert.equal(store().editorBuffers[key].saved, "save snapshot");
    const late = store().saveEditorBuffer("test-session", "example.tsx");
    const identity = store().editorBuffers[key].identity;
    useAppStore.setState({ editorBuffers: {} }); // Owner deletion while native write is pending.
    store().setEditorBuffer(key, "new buffer", "new disk");
    assert.notEqual(store().editorBuffers[key].identity, identity);
    writes[2].resolve(); await late;
    assert.equal(store().editorBuffers[key].saved, "new disk", "An old acknowledgement cannot mark a recreated buffer saved");
    store().discardEditorBuffer(key);
  } finally { client.writeTextFile = originalWrite; }
  console.log("Editor: CSP nonce, TSX/Markdown parsing, editability, Save shortcut, wrapping, shared Save serialization, failure retry and buffer generation retention passed");
} finally { await server.close(); }
