/**
 * Math delimiters for a Markdown block before `remark-math` reads it (ADR-160, ADR-179).
 * `remark-math` accepts any `$…$`, so prices and shell variables ("costs $5 and $10") would
 * turn into formulas; the reply rules stay Pandoc's instead: the opening `$` is followed by
 * a non-space and not preceded by a word character or `$`, the closing one follows a
 * non-space and is not followed by a digit. A `$` that is not math becomes `\$`. `\(…\)` and
 * `\[…\]`, which Markdown would read as escapes, become `$$…$$`. Fenced code and inline code
 * are never touched, and a formula over `MATH_MAX` characters stays text.
 */

/** At most this much TeX per formula; longer source stays text. */
export const MATH_MAX = 4000;

/** Where `$…$` opened at `open` closes, or -1 (Pandoc's rule; never across a blank line). */
export function inlineMathClose(text: string, open: number): number {
  const first = text[open + 1] ?? "";
  if (!first || /\s|\$/.test(first) || /[\w$]/.test(text[open - 1] ?? "")) return -1;
  for (let i = open + 1; i < text.length && i - open <= MATH_MAX; i++) {
    if (text[i] === "\\") { i += 1; continue; }
    if (text[i] === "\n" && /^\n[ \t]*\n/.test(text.slice(i, i + 40))) return -1;
    if (text[i] === "$") return /\s/.test(text[i - 1]) || /\d/.test(text[i + 1] ?? "") ? -1 : i;
  }
  return -1;
}

function blankLineBetween(value: string): boolean {
  return /\n[ \t]*\n/.test(value);
}

function prepareText(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const lineStart = i === 0 || text[i - 1] === "\n";
    if (ch === "`") {
      const ticks = /^`+/.exec(text.slice(i, i + 64))![0];
      const end = text.indexOf(ticks, i + ticks.length);
      if (end > 0) { out += text.slice(i, end + ticks.length); i = end + ticks.length; continue; }
      out += ticks; i += ticks.length; continue;
    }
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === "(" || next === "[") {
        const close = next === "(" ? "\\)" : "\\]";
        const end = text.indexOf(close, i + 2);
        const tex = end > i + 2 ? text.slice(i + 2, end).trim() : "";
        if (tex && tex.length <= MATH_MAX && !tex.includes("$") && !blankLineBetween(text.slice(i, end))) {
          const alone = next === "[" && /^ {0,3}$/.test(text.slice(text.lastIndexOf("\n", i - 1) + 1, i)) && /^[ \t]*(?:\n|$)/.test(text.slice(end + 2));
          out += alone ? `$$\n${tex}\n$$` : `$$${tex}$$`;
          i = end + 2;
          continue;
        }
      }
      // Any other escape (including `\$`) is kept as written.
      out += next === undefined ? ch : ch + next;
      i += next === undefined ? 1 : 2;
      continue;
    }
    if (ch === "$") {
      if (text[i + 1] === "$") {
        const end = text.indexOf("$$", i + 2);
        const body = end > i + 2 ? text.slice(i + 2, end) : "";
        if (body.trim() && body.length <= MATH_MAX) { out += text.slice(i, end + 2); i = end + 2; continue; }
        // An unclosed `$$` opening a line may be display math that is still streaming.
        if (lineStart) { out += "$$"; i += 2; continue; }
        out += "\\$\\$"; i += 2; continue;
      }
      const end = inlineMathClose(text, i);
      if (end > 0) { out += text.slice(i, end + 1); i = end + 1; continue; }
      out += "\\$"; i += 1; continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** The block's source with math delimiters normalized; `source` itself when it has none. */
export function prepareMath(source: string): string {
  if (!source.includes("$") && !source.includes("\\(") && !source.includes("\\[")) return source;
  const lines = source.split("\n");
  let result = "";
  let fence: { char: string; length: number } | null = null;
  let pending: string[] = [];
  const flush = () => {
    if (pending.length) result += prepareText(pending.join("\n")) + "\n";
    pending = [];
  };
  for (const line of lines) {
    if (fence) {
      result += line + "\n";
      const close = /^[ \t>]*(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      continue;
    }
    const open = /^[ \t>]*(`{3,}|~{3,})(.*)$/.exec(line);
    if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
      flush();
      result += line + "\n";
      fence = { char: open[1][0], length: open[1].length };
      continue;
    }
    pending.push(line);
  }
  flush();
  return result.slice(0, -1);
}
