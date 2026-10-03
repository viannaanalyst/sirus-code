export type TranscriptBlock = { kind: "text"; content: string } | { kind: "code"; content: string; language: string };

/** Fences are parsed as text, never HTML. An unfinished streaming fence remains a code block. */
export function parseTranscript(content: string): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  const lines = content.split("\n");
  let pending: string[] = [];
  let fence: { marker: string; length: number; language: string } | null = null;
  const flush = () => {
    if (pending.length) blocks.push(fence ? { kind: "code", content: pending.join("\n"), language: fence.language } : { kind: "text", content: pending.join("\n") });
    pending = [];
  };
  for (const line of lines) {
    if (fence) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence.marker && close[1].length >= fence.length) { flush(); fence = null; }
      else pending.push(line);
    } else {
      const open = line.match(/^ {0,3}(`{3,}|~{3,})([^`]*)$/);
      if (open) {
        flush();
        fence = { marker: open[1][0], length: open[1].length, language: open[2].trim().split(/\s/)[0] || "text" };
      } else pending.push(line);
    }
  }
  flush();
  return blocks;
}

export interface DiffLine { content: string; kind: "addition" | "deletion" | "context" | "header"; oldLine: number | null; newLine: number | null }
export function parseUnifiedDiff(diff: string): DiffLine[] {
  let oldLine = 0, newLine = 0, inHunk = false;
  const lines = diff.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((content) => {
    const hunk = content.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); inHunk = true; }
    if (!inHunk || hunk || content.startsWith("\\ No newline")) return { content, kind: "header", oldLine: null, newLine: null };
    if (content.startsWith("+")) return { content, kind: "addition", oldLine: null, newLine: newLine++ };
    if (content.startsWith("-")) return { content, kind: "deletion", oldLine: oldLine++, newLine: null };
    if (content.startsWith(" ")) return { content, kind: "context", oldLine: oldLine++, newLine: newLine++ };
    return { content, kind: "header", oldLine: null, newLine: null };
  });
}
