/**
 * The prompt editor's document and the plain string it stands for (ADR-168).
 *
 * The draft is a string; the editor shows it as one paragraph whose children are text, line
 * breaks and chips. Every function here is pure, so the round trip string → document → string is
 * tested without a browser. Offsets are UTF-16 code units, like a textarea's `selectionStart`.
 */
import type { Node as ProseNode, Schema } from "@tiptap/pm/model";
import { CHIP_NODE, type ChipKind } from "@/lib/composer-chip";
import { composerPaintSegments } from "@/lib/link-chips";

interface JsonNode { type: string; text?: string; attrs?: Record<string, unknown> }

/** The paragraph content for `text`: tokens and web addresses as chips, `\n` as line breaks. */
export function textToInline(text: string): JsonNode[] {
  const content: JsonNode[] = [];
  text.split("\n").forEach((line, index) => {
    if (index > 0) content.push({ type: "hardBreak" });
    for (const segment of composerPaintSegments(line)) {
      if (!segment.text) continue;
      content.push(segment.kind === "text" ? { type: "text", text: segment.text } : { type: CHIP_NODE, attrs: { kind: segment.kind, text: segment.text } });
    }
  });
  return content;
}

/** The whole document for `text`, in the shape `Editor` takes as content. */
export function textToDoc(text: string): { type: "doc"; content: [{ type: "paragraph"; content?: JsonNode[] }] } {
  const content = textToInline(text);
  return { type: "doc", content: [content.length ? { type: "paragraph", content } : { type: "paragraph" }] };
}

/**
 * Text written into the editor (a paste, a completion): plain characters and line breaks. Tokens in it
 * become chips once the caret leaves them, so a directory being browsed stays text.
 */
export function textToFragment(schema: Schema, text: string) {
  const content: JsonNode[] = [];
  text.replace(/\r\n?/g, "\n").split("\n").forEach((line, index) => {
    if (index > 0) content.push({ type: "hardBreak" });
    if (line) content.push({ type: "text", text: line });
  });
  return schema.nodeFromJSON({ type: "paragraph", content }).content;
}

const leafText = (node: ProseNode): string => node.type.name === CHIP_NODE ? String(node.attrs.text) : node.type.name === "hardBreak" ? "\n" : "";

/** The characters a document stands for: chips give back what they were made from. */
export function docToText(doc: ProseNode): string {
  return doc.textBetween(0, doc.content.size, "\n", leafText);
}

/** The text of a slice of the document (what a copy puts on the clipboard). */
export function rangeToText(doc: ProseNode, from: number, to: number): string {
  return doc.textBetween(from, to, "\n", leafText);
}

/** Plain-text offset of a document position. */
export function offsetAtPos(doc: ProseNode, pos: number): number {
  return rangeToText(doc, 0, Math.max(0, Math.min(pos, doc.content.size))).length;
}

/**
 * Document position of a plain-text offset. A chip is one unit: an offset inside it lands after it.
 * The editor holds a single paragraph, so positions start at 1.
 */
export function posAtOffset(doc: ProseNode, offset: number): number {
  const paragraph = doc.firstChild;
  if (!paragraph) return 0;
  let consumed = 0;
  let pos = 1;
  for (let index = 0; index < paragraph.childCount; index++) {
    const child = paragraph.child(index);
    const length = leafText(child).length || (child.isText ? child.nodeSize : 0);
    if (child.isText) {
      if (offset <= consumed + length) return pos + Math.max(0, offset - consumed);
    } else if (offset <= consumed) return pos;
    else if (offset < consumed + length) return pos + child.nodeSize;
    consumed += length;
    pos += child.nodeSize;
  }
  return pos;
}

export interface ChipEdit { from: number; to: number; kind: ChipKind; text: string }

const isChip = (node: ProseNode | null | undefined) => node?.type.name === CHIP_NODE;

/**
 * Text runs that should turn into chips. A token stays text while the caret touches it (it is
 * still being typed, and the `@`/`/` list needs it as text); once the caret moves on, it becomes a chip.
 * A token glued to a neighbouring chip stays text too, so the characters read back the same.
 */
export function findChipEdits(doc: ProseNode, caret: number | null): ChipEdit[] {
  const paragraph = doc.firstChild;
  if (!paragraph) return [];
  const edits: ChipEdit[] = [];
  let pos = 1;
  paragraph.forEach((child, _offset, index) => {
    const start = pos;
    pos += child.nodeSize;
    if (!child.isText || !child.text) return;
    let at = 0;
    for (const segment of composerPaintSegments(child.text)) {
      const from = start + at;
      const to = from + segment.text.length;
      at += segment.text.length;
      if (segment.kind === "text") continue;
      if (caret !== null && caret >= from && caret <= to) continue;
      if (from === start && isChip(index > 0 ? paragraph.child(index - 1) : null)) continue;
      if (to === start + child.nodeSize && isChip(index + 1 < paragraph.childCount ? paragraph.child(index + 1) : null)) continue;
      edits.push({ from, to, kind: segment.kind, text: segment.text });
    }
  });
  return edits;
}
