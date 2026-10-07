/**
 * Markdown for assistant replies in the transcript: headings, paragraphs (line
 * breaks kept), nested lists, quotes, rules and GFM tables, with inline bold,
 * italic, strikethrough, code and links. Fenced code is split out earlier by
 * `parseTranscript`. Text only: nothing here produces HTML.
 */
export type ChatInline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold" | "italic" | "strike"; children: ChatInline[] }
  | { kind: "link"; url: string; children: ChatInline[] }
  /** `![alt](https://… | data:image/…)`; other image paths stay links. */
  | { kind: "image"; url: string; alt: string };

export type ChatBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: ChatListItem[] }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "table"; header: string[]; align: ("left" | "center" | "right" | null)[]; rows: string[][] };

export interface ChatListItem { depth: number; ordered: boolean; number: number | null; text: string; task: boolean | null }

const LIST = /^(\s*)([-*+]|(\d{1,9})[.)])\s+(.*)$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

export function parseChatMarkdown(source: string): ChatBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ChatBlock[] = [];
  let index = 0;
  const starts = (line: string) => HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || LIST.test(line);
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const heading = line.match(HEADING);
    if (heading) { blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] }); index += 1; continue; }
    if (RULE.test(line)) { blocks.push({ kind: "rule" }); index += 1; continue; }
    if (QUOTE.test(line)) {
      const content: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index])) { content.push(lines[index].match(QUOTE)![1]); index += 1; }
      blocks.push({ kind: "quote", text: content.join("\n") });
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1]) && lines[index + 1].includes("-")) {
      const header = cells(line);
      const align = cells(lines[index + 1]).map((cell) => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : null);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) { rows.push(cells(lines[index])); index += 1; }
      blocks.push({ kind: "table", header, align, rows });
      continue;
    }
    if (LIST.test(line)) {
      const items: ChatListItem[] = [];
      const indents: number[] = [];
      while (index < lines.length) {
        const match = lines[index].match(LIST);
        if (!match) {
          // An indented continuation line belongs to the previous item.
          if (items.length && /^\s{2,}\S/.test(lines[index])) { items[items.length - 1].text += `\n${lines[index].trim()}`; index += 1; continue; }
          break;
        }
        const indent = match[1].replace(/\t/g, "  ").length;
        while (indents.length && indent < indents[indents.length - 1]) indents.pop();
        if (!indents.length || indent > indents[indents.length - 1]) indents.push(indent);
        const task = /^\[([ xX])\]\s+/.exec(match[4]);
        items.push({ depth: Math.min(indents.length - 1, 5), ordered: match[3] !== undefined, number: match[3] !== undefined ? Number(match[3]) : null, text: task ? match[4].slice(task[0].length) : match[4], task: task ? task[1] !== " " : null });
        index += 1;
      }
      blocks.push({ kind: "list", items });
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !starts(lines[index]) && !(lines[index].includes("|") && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1]))) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}

/** Inline spans; code is taken literally, emphasis nests (`**bold `code`**`). */
export function parseChatInline(text: string): ChatInline[] {
  const out: ChatInline[] = [];
  let plain = "";
  const flush = () => { if (plain) out.push({ kind: "text", text: plain }); plain = ""; };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const ch = text[i];
    if (ch === "\\" && /[\\`*_~[\]()#|-]/.test(text[i + 1] ?? "")) { plain += text[i + 1]; i += 2; continue; }
    if (ch === "`") {
      const ticks = /^`+/.exec(rest)![0];
      const end = text.indexOf(ticks, i + ticks.length);
      if (end > i) {
        flush();
        out.push({ kind: "code", text: text.slice(i + ticks.length, end).replace(/^ (.+) $/, "$1") });
        i = end + ticks.length;
        continue;
      }
    }
    const emphasis = /^(\*\*|__|~~)/.exec(rest) ?? (/^[*_]/.test(rest) ? [ch] : null);
    if (emphasis) {
      const marker = emphasis[0];
      const end = findClose(text, i + marker.length, marker);
      // `_` only emphasizes at word boundaries, so snake_case stays text.
      const boundary = marker[0] !== "_" || (!/\w/.test(text[i - 1] ?? "") && !/\w/.test(text[end + marker.length] ?? ""));
      if (end > i + marker.length && boundary && !/\s/.test(text[i + marker.length]) && !/\s/.test(text[end - 1])) {
        flush();
        out.push({ kind: marker === "~~" ? "strike" : marker.length === 2 ? "bold" : "italic", children: parseChatInline(text.slice(i + marker.length, end)) });
        i = end + marker.length;
        continue;
      }
    }
    if (ch === "!" && text[i + 1] === "[") {
      const image = /^!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
      if (image) {
        flush();
        const url = image[2], alt = image[1];
        out.push(/^https:\/\//.test(url) || /^data:image\/(?:png|jpe?g|gif|webp);base64,/.test(url) ? { kind: "image", url, alt } : { kind: "link", url, children: [{ kind: "text", text: alt || url }] });
        i += image[0].length;
        continue;
      }
    }
    if (ch === "[") {
      const link = /^\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
      if (link) { flush(); out.push({ kind: "link", url: link[2], children: parseChatInline(link[1]) }); i += link[0].length; continue; }
    }
    if (ch === "h" && /^https?:\/\//.test(rest) && !/\w/.test(text[i - 1] ?? "")) {
      const url = /^https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]/.exec(rest);
      if (url) { flush(); out.push({ kind: "link", url: url[0], children: [{ kind: "text", text: url[0] }] }); i += url[0].length; continue; }
    }
    plain += ch;
    i += 1;
  }
  flush();
  return out;
}

/** The closing marker outside inline code. */
function findClose(text: string, from: number, marker: string): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === "\\") { i += 1; continue; }
    if (text[i] === "`") { const close = text.indexOf("`", i + 1); if (close < 0) return -1; i = close; continue; }
    if (text.startsWith(marker, i) && (marker.length === 2 || text[i + 1] !== marker)) return i;
    if (text[i] === "\n" && text[i + 1] === "\n") return -1;
  }
  return -1;
}

/**
 * A workspace file reference in inline code or a link target: a relative path
 * (or one inside `cwd`) with a name that looks like a file, optionally `:line`.
 */
export function fileReference(raw: string, cwd: string | null): { path: string; line: number | null } | null {
  let value = raw.trim().replace(/^["']|["']$/g, "");
  if (!value || value.length > 300 || /\s|:\/\//.test(value)) return null;
  if (value.startsWith("file://")) value = decodeURI(value.slice(7));
  const position = /:(\d+)(?::\d+)?$/.exec(value);
  const line = position ? Number(position[1]) : null;
  if (position) value = value.slice(0, position.index);
  value = value.replace(/#L(\d+).*$/, "");
  if (value.startsWith("/")) {
    if (!cwd || !value.startsWith(`${cwd.replace(/\/$/, "")}/`)) return null;
    value = value.slice(cwd.replace(/\/$/, "").length + 1);
  }
  value = value.replace(/^\.\//, "");
  if (!value || value.split("/").some((part) => part === ".." || part === "." || part === "")) {
    return value.endsWith("/") && !value.slice(0, -1).split("/").some((part) => !part || part === "..") ? { path: value.slice(0, -1), line } : null;
  }
  const name = value.split("/").pop()!;
  const looksLikeFile = /\.[A-Za-z][\w-]{0,9}$/.test(name) || /^(Makefile|Dockerfile|LICENSE|README|Gemfile|Procfile|\.env\.example|\.gitignore)$/.test(name);
  if (!looksLikeFile && !value.includes("/")) return null;
  if (!/^[\w@.+~-]+(\/[\w@.+~ -]+)*$/.test(value)) return null;
  return { path: value, line };
}
