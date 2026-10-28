/**
 * The chip node of the prompt editor (ADR-168): an `@file`, `/skill` or web address shown as one
 * inline unit. The node keeps the characters it stands for in `text`, so the draft stored as a plain
 * string never changes shape.
 */
import { Node } from "@tiptap/core";
import { describeLinkChip } from "@/lib/link-chips";

export type ChipKind = "skill" | "file" | "link";

export const CHIP_NODE = "composerChip";

/** `@"my dir/a.md"` or `@src/a.ts` → the path. */
export function filePathOf(text: string): string {
  const quoted = /^@"((?:\\.|[^"\\])*)"?$/.exec(text);
  return quoted ? quoted[1].replace(/\\(.)/g, "$1") : text.slice(1);
}

/** What a chip shows in place of the typed characters. */
export function chipLabel(kind: ChipKind, text: string): string {
  if (kind === "skill") return text;
  if (kind === "link") return describeLinkChip(text).label;
  const path = filePathOf(text);
  const name = path.replace(/\/+$/, "").split("/").at(-1) || path;
  return path.endsWith("/") ? `${name}/` : name;
}

const ICONS: Record<ChipKind | "folder", string> = {
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  skill: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M14.5 8 9.5 16"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};

function chipElement(kind: ChipKind, text: string): HTMLElement {
  const dom = document.createElement("span");
  dom.className = `composer-chip composer-chip-${kind}`;
  dom.dataset.chipKind = kind;
  dom.title = kind === "file" ? filePathOf(text) : text;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "composer-chip-icon");
  svg.innerHTML = kind === "file" && filePathOf(text).endsWith("/") ? ICONS.folder : ICONS[kind];
  const label = document.createElement("span");
  label.className = "composer-chip-label";
  label.textContent = chipLabel(kind, text);
  dom.append(svg, label);
  return dom;
}

export const ComposerChip = Node.create({
  name: CHIP_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { kind: { default: "file" }, text: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-composer-chip]", getAttrs: element => ({ kind: element.getAttribute("data-kind") ?? "file", text: element.getAttribute("data-text") ?? "" }) }];
  },
  renderHTML({ node }) {
    return ["span", { "data-composer-chip": "", "data-kind": node.attrs.kind, "data-text": node.attrs.text }, node.attrs.text];
  },
  renderText({ node }) {
    return node.attrs.text;
  },
  addNodeView() {
    return ({ node }) => ({ dom: chipElement(node.attrs.kind as ChipKind, node.attrs.text as string) });
  },
});
