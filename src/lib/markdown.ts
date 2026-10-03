export type MarkdownBlock =
  | { kind: "code"; language: string; content: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "paragraph"; text: string };

export type MarkdownInline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; url: string };

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*(```|~~~)\s*([\w+#-]*)\s*$/;

/** Line-oriented markdown parser: enough structure for a readable preview. */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1];
      const language = fence[2] ?? "";
      const content: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(marker)) {
        content.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ kind: "code", language, content: content.join("\n") });
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const content: string[] = [];
      while (index < lines.length) {
        const quote = lines[index].match(/^\s*>\s?(.*)$/);
        if (!quote) break;
        content.push(quote[1]);
        index += 1;
      }
      blocks.push({ kind: "quote", text: content.join("\n") });
      continue;
    }
    const list = line.match(LIST_ITEM);
    if (list) {
      const ordered = /\d/.test(list[1]);
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].match(LIST_ITEM);
        if (!item) break;
        items.push(item[2].trim());
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const next = lines[index];
      if (!next.trim() || FENCE.test(next) || /^(#{1,6})\s+/.test(next) || /^\s*>/.test(next) || LIST_ITEM.test(next)) break;
      paragraph.push(next.trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }
  return blocks;
}

const INLINE = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))/g;

export function parseInline(text: string): MarkdownInline[] {
  const tokens: MarkdownInline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) tokens.push({ kind: "text", text: text.slice(last, at) });
    if (match[1]) tokens.push({ kind: "bold", text: match[2] });
    else if (match[3]) tokens.push({ kind: "italic", text: match[4] });
    else if (match[5]) tokens.push({ kind: "code", text: match[6] });
    else if (match[7]) tokens.push({ kind: "link", text: match[8], url: match[9] });
    last = at + match[0].length;
  }
  if (last < text.length) tokens.push({ kind: "text", text: text.slice(last) });
  return tokens;
}
