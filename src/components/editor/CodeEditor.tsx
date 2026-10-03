import { indentWithTab } from "@codemirror/commands";
import { editorStyleNonce } from "@/lib/editor-nonce";
import "@/styles/code-editor.css";
import { basicSetup } from "codemirror";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { EditorView, keymap } from "@codemirror/view";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { python } from "@codemirror/lang-python";
import { useEffect, useRef } from "react";

export type EditorLanguage = "javascript" | "typescript" | "json" | "css" | "html" | "markdown" | "rust" | "python";

const EXTENSION_LANGUAGES: Record<string, EditorLanguage> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "css",
  less: "css",
  html: "html",
  htm: "html",
  vue: "html",
  svelte: "html",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  rs: "rust",
  py: "python",
};

export function languageForPath(path: string): EditorLanguage | null {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_LANGUAGES[extension] ?? null;
}

/** Palette-aware code colors, with the same fonts and sizes as Appearance. */
const highlight = HighlightStyle.define([
  { tag: tags.heading, color: "var(--text-primary)", fontWeight: "700" },
  { tag: tags.strong, color: "var(--text-primary)", fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, color: "var(--accent)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--text-muted)" },
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: "var(--code-keyword)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--code-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--code-number)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--code-comment)", fontStyle: "italic" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--code-type)" },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName), tags.labelName], color: "var(--code-function)" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--code-property)" },
  { tag: [tags.tagName, tags.angleBracket], color: "var(--code-tag)" },
  { tag: [tags.variableName, tags.name], color: "var(--text-primary)" },
  { tag: [tags.punctuation, tags.bracket, tags.separator, tags.meta], color: "var(--text-secondary)" },
  { tag: tags.invalid, color: "var(--danger)" },
]);

const languageExtensions: Record<EditorLanguage, () => Extension> = {
  javascript: () => javascript({ jsx: true }),
  typescript: () => javascript({ jsx: true, typescript: true }),
  json: () => json(),
  css: () => css(),
  html: () => html(),
  markdown: () => markdown(),
  rust: () => rust(),
  python: () => python(),
};

function theme(dark: boolean): Extension {
  return EditorView.theme(
    {
      "&": {
        height: "100%",
        backgroundColor: "var(--background-2)",
        color: "var(--text-primary)",
        fontSize: "var(--code-font-size)",
      },
      ".cm-scroller": {
        fontFamily: "var(--code-font-family)",
        lineHeight: "1.55",
        overflow: "auto",
      },
      ".cm-content": { caretColor: "var(--accent)", padding: "6px 0" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "color-mix(in srgb, var(--accent) 24%, transparent)",
      },
      ".cm-gutters": {
        backgroundColor: "var(--background-1)",
        color: "var(--text-muted)",
        border: "none",
      },
      ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--background-3) 55%, transparent)" },
      ".cm-activeLineGutter": { backgroundColor: "var(--background-3)" },
      ".cm-panels": { backgroundColor: "var(--background-1)", color: "var(--text-primary)" },
      ".cm-tooltip": { backgroundColor: "var(--background-1)", border: "1px solid var(--border-subtle)" },
      ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent)" },
      ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--accent) 14%, transparent)" },
    },
    { dark },
  );
}

/** Shared construction lets regressions verify the actual CSP/editable state. */
export function editorExtensions({ language, nonce, onChange, onSave }: { language: EditorLanguage | null; nonce?: string; onChange: (value: string) => void; onSave: () => void }): Extension[] {
  return [
    basicSetup,
    EditorView.editable.of(true),
    EditorState.readOnly.of(false),
    ...(nonce ? [EditorView.cspNonce.of(nonce)] : []),
    syntaxHighlighting(highlight),
    ...(language === "markdown" ? [EditorView.lineWrapping] : []),
    ...(language ? [languageExtensions[language]()] : []),
    EditorState.tabSize.of(2),
    keymap.of([{ key: "Mod-s", preventDefault: true, run: () => { onSave(); return true; } }, indentWithTab]),
    EditorView.contentAttributes.of({ "aria-label": "Code editor", "spellcheck": "false" }),
    EditorView.updateListener.of(update => { if (update.docChanged) onChange(update.state.doc.toString()); }),
  ];
}

export function CodeEditor({
  value,
  label = "Code editor",
  language,
  onChange,
  onSave,
}: {
  value: string;
  label?: string;
  language: EditorLanguage | null;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const initialValue = useRef(value);
  initialValue.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const palette = new Compartment();
    const resolvedDark = () => document.documentElement.dataset.theme !== "light";
    const state = EditorState.create({
      doc: initialValue.current,
      extensions: [
        ...editorExtensions({ language, nonce: editorStyleNonce(document), onChange: value => onChangeRef.current(value), onSave: () => onSaveRef.current() }),
        EditorView.contentAttributes.of({ "aria-label": label }),
        palette.of(theme(resolvedDark())),
      ],
    });
    const instance = new EditorView({ state, parent: node });
    view.current = instance;
    // The pane mounts inside a freshly split layout; measure after paint and on
    // every container resize so gutters and lines never drift.
    const measure = () => instance.requestMeasure();
    const firstFrame = requestAnimationFrame(measure);
    let secondFrame = 0;
    const layoutFrame = requestAnimationFrame(() => { secondFrame = requestAnimationFrame(measure); });
    const appearance = new MutationObserver(() => instance.dispatch({ effects: palette.reconfigure(theme(resolvedDark())) }));
    appearance.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => {
      [firstFrame, layoutFrame, secondFrame].forEach(frame => cancelAnimationFrame(frame));
      appearance.disconnect();
      observer?.disconnect();
      instance.destroy();
      view.current = null;
    };
  }, [language, label]);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (current === value) return;
    instance.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return <div ref={host} className="code-editor-host h-full min-h-0 min-w-0 overflow-hidden" />;
}
