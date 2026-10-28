/**
 * The prompt editor's schema (ADR-168): one paragraph of text, line breaks and chips. No marks,
 * lists or headings: the draft is plain text.
 */
import { Extension } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { CHIP_NODE, ComposerChip } from "@/lib/composer-chip";
import { findChipEdits } from "@/lib/composer-doc";

/** Turns `@file`, `/skill` and web addresses into chips once the caret has moved past them. */
const ChipTokens = Extension.create({
  name: "chipTokens",
  addProseMirrorPlugins() {
    let view: EditorView | null = null;
    return [new Plugin({
      key: new PluginKey("chipTokens"),
      view(editorView) {
        view = editorView;
        return { destroy() { view = null; } };
      },
      appendTransaction(transactions, _before, state) {
        // Never while an input method is composing: replacing its text would cancel the composition.
        if (view?.composing || !transactions.some(tr => tr.docChanged || tr.selectionSet || tr.getMeta("blur"))) return null;
        const blurred = transactions.some(tr => tr.getMeta("blur"));
        const caret = !blurred && state.selection.empty ? state.selection.from : null;
        const edits = findChipEdits(state.doc, caret);
        if (!edits.length) return null;
        const tr = state.tr;
        for (const edit of edits.reverse()) tr.replaceWith(edit.from, edit.to, state.schema.nodes[CHIP_NODE].create({ kind: edit.kind, text: edit.text }));
        return tr;
      },
    })];
  },
});

export const composerExtensions = [
  Document.extend({ content: "paragraph" }),
  Paragraph,
  Text,
  HardBreak,
  ComposerChip,
  UndoRedo,
  ChipTokens,
];
