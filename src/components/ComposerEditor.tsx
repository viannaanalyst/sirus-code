import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Slice } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";
import { CHIP_NODE } from "@/lib/composer-chip";
import { composerExtensions } from "@/lib/composer-extensions";
import { docToText, offsetAtPos, posAtOffset, textToDoc, textToFragment } from "@/lib/composer-doc";
import { registerComposer, type ComposerHandle } from "@/lib/composer-focus";

export interface ComposerPasteContext { text: string; start: number; end: number }

export interface ComposerEditorProps {
  /** The draft owner (`session:<id>` / `project:<id>`). */
  owner: string;
  /** The stored draft; the editor follows it when it changes from outside. */
  value: string;
  /** The stored draft at this instant (the render's `value` may be one step behind). */
  readValue: () => string;
  editable: boolean;
  placeholder: string;
  className: string;
  /** Attributes on the editable element (aria-*, spellcheck, autocorrect), applied as they change. */
  attributes: Record<string, string | undefined>;
  onText: (text: string) => void;
  onCursor: (text: string, start: number, end: number) => void;
  onFocus: () => void;
  onBlur: () => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  /** Returns true when it handled the key. */
  onKeyDown: (event: KeyboardEvent, handle: ComposerHandle) => boolean;
  /** Returns true when it took over the paste; otherwise the clipboard text goes in as plain text. */
  onPaste: (event: ClipboardEvent, context: ComposerPasteContext) => boolean;
}

/**
 * The prompt box (ADR-168): a TipTap editor over one paragraph. The stored draft stays a plain
 * string; `@file`, `/skill` and web addresses show as inline chips and read back as the same characters.
 */
export const ComposerEditor = forwardRef<ComposerHandle, ComposerEditorProps>(function ComposerEditor(props, ref) {
  const { owner, value, editable, placeholder } = props;
  const latest = useRef(props);
  latest.current = props;
  const report = (editor: Editor) => {
    const { doc, selection } = editor.state;
    latest.current.onCursor(docToText(doc), offsetAtPos(doc, selection.from), offsetAtPos(doc, selection.to));
  };
  const handleRef = useRef<ComposerHandle | null>(null);
  const editor = useEditor({
    extensions: composerExtensions,
    content: textToDoc(props.readValue()),
    editable,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { role: "textbox", "aria-multiline": "true", class: props.className },
      scrollMargin: 6,
      scrollThreshold: 6,
      clipboardTextSerializer: slice => slice.content.textBetween(0, slice.content.size, "\n", node => node.type.name === "hardBreak" ? "\n" : String(node.attrs.text ?? "")),
      handleKeyDown: (view, event) => {
        const handle = handleRef.current;
        if (handle && latest.current.onKeyDown(event, handle)) return true;
        // A chip is one unit: Backspace right after it (or Delete right before it) removes all of it.
        const { selection } = view.state;
        if (!selection.empty || event.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey) return false;
        const chip = event.key === "Backspace" ? selection.$from.nodeBefore : event.key === "Delete" ? selection.$from.nodeAfter : null;
        if (chip?.type.name !== CHIP_NODE) return false;
        const from = event.key === "Backspace" ? selection.from - chip.nodeSize : selection.from;
        event.preventDefault();
        view.dispatch(view.state.tr.delete(from, from + chip.nodeSize).scrollIntoView());
        return true;
      },
      handlePaste: (view, event) => {
        const data = event.clipboardData;
        if (!data) return false;
        const { doc, selection } = view.state;
        const text = data.getData("text/plain");
        if (latest.current.onPaste(event, { text: docToText(doc), start: offsetAtPos(doc, selection.from), end: offsetAtPos(doc, selection.to) })) return true;
        // Whatever the clipboard also carries (HTML, rich text), the draft takes the plain characters.
        event.preventDefault();
        if (text) view.dispatch(view.state.tr.replaceSelection(new Slice(textToFragment(view.state.schema, text), 0, 0)).scrollIntoView());
        return true;
      },
      handleDrop: (_view, event) => {
        // Finder files are attached by the native window drop; the browser must not navigate to them.
        if (!event.dataTransfer?.files.length) return false;
        event.preventDefault();
        return true;
      },
      handleDOMEvents: {
        compositionstart: () => { latest.current.onCompositionStart(); return false; },
        compositionend: () => { latest.current.onCompositionEnd(); return false; },
      },
    },
    onUpdate: ({ editor: instance }) => {
      latest.current.onText(docToText(instance.state.doc));
      report(instance);
    },
    onSelectionUpdate: ({ editor: instance }) => report(instance),
    onFocus: () => latest.current.onFocus(),
    onBlur: () => latest.current.onBlur(),
  });

  const handle = useMemo<ComposerHandle | null>(() => {
    if (!editor) return null;
    const dispatch = (build: (state: EditorState) => Transaction) => { if (!editor.isDestroyed) editor.view.dispatch(build(editor.state)); };
    return {
      owner,
      get element() { return editor.isDestroyed ? null : editor.view.dom as HTMLElement; },
      focus: options => {
        if (editor.isDestroyed || !editor.isEditable) return;
        if (options?.end) dispatch(state => state.tr.setSelection(TextSelection.atEnd(state.doc)));
        editor.view.focus();
        if (!options?.preventScroll) dispatch(state => state.tr.scrollIntoView());
      },
      insert: text => dispatch(state => state.tr.replaceSelection(new Slice(textToFragment(state.schema, text), 0, 0)).scrollIntoView()),
      replaceRange: (start, end, text) => dispatch(state => {
        const from = posAtOffset(state.doc, start);
        const to = Math.max(from, posAtOffset(state.doc, end));
        const fragment = textToFragment(state.schema, text);
        const tr = state.tr.replaceWith(from, to, fragment);
        return tr.setSelection(TextSelection.create(tr.doc, from + fragment.size)).scrollIntoView();
      }),
      setCaret: offset => dispatch(state => state.tr.setSelection(TextSelection.create(state.doc, posAtOffset(state.doc, offset)))),
      text: () => docToText(editor.state.doc),
      selection: () => ({ start: offsetAtPos(editor.state.doc, editor.state.selection.from), end: offsetAtPos(editor.state.doc, editor.state.selection.to) }),
      editable: () => !editor.isDestroyed && editor.isEditable,
      visible: () => !editor.isDestroyed && editor.view.dom.getClientRects().length > 0,
    };
  }, [editor, owner]);
  handleRef.current = handle;
  useImperativeHandle(ref, () => handle as ComposerHandle, [handle]);
  useLayoutEffect(() => (handle ? registerComposer(handle) : undefined), [handle]);

  useLayoutEffect(() => {
    if (editor && !editor.isDestroyed && editor.isEditable !== editable) editor.setEditable(editable, false);
  }, [editor, editable]);

  // The stored draft is the truth: a change that did not come from typing (a recalled prompt, a
  // restored stash, a quick reply, a send that cleared it) replaces the document and puts the caret at the end.
  const syncedOwner = useRef(owner);
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const target = latest.current.readValue();
    const switched = syncedOwner.current !== owner;
    if (!switched && (editor.view.composing || docToText(editor.state.doc) === target)) return;
    syncedOwner.current = owner;
    const doc = editor.schema.nodeFromJSON(textToDoc(target));
    if (switched) {
      // Another conversation's draft: a fresh state, so undo never reaches into the previous one.
      editor.view.updateState(EditorState.create({ doc, selection: TextSelection.atEnd(doc), plugins: editor.state.plugins }));
    } else {
      const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content).setMeta("addToHistory", false).setMeta("preventUpdate", true);
      editor.view.dispatch(tr.setSelection(TextSelection.atEnd(tr.doc)));
    }
    report(editor);
  }, [editor, owner, value]);

  // aria-* and spellcheck follow the composer's state without rebuilding the editor.
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const dom = editor.view.dom;
    const wanted: Record<string, string | undefined> = { ...props.attributes, "data-draft-owner": owner, "aria-disabled": editable ? undefined : "true" };
    for (const [name, attribute] of Object.entries(wanted)) {
      if (attribute === undefined) dom.removeAttribute(name);
      else if (dom.getAttribute(name) !== attribute) dom.setAttribute(name, attribute);
    }
  });

  return <>
    {!value && placeholder ? <div aria-hidden="true" className="composer-placeholder ui-chat pointer-events-none absolute inset-0 overflow-hidden text-text-muted">{placeholder}</div> : null}
    <EditorContent editor={editor} />
  </>;
});
