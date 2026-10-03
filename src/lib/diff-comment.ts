import { parseUnifiedDiff, type DiffLine } from "./transcript";
import { appendTranscriptQuote } from "./transcript-selection";

export interface DiffComment { path: string; diff: string; from: number; to: number; comment: string }
export function reviewDiffLines(diff: string): DiffLine[] {
  if (!diff.startsWith("+++ untracked\n")) return parseUnifiedDiff(diff);
  const lines = diff.slice("+++ untracked\n".length).split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((content, index) => ({ content: `+${content}`, kind: "addition", oldLine: null, newLine: index + 1 }));
}
export function appendDiffComment(draft: string, path: string, diff: string, from: number, to: number, comment: string): string | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || !comment.trim() || comment.length > 16384) return null;
  const lines = reviewDiffLines(diff);
  if (to >= lines.length) return null;
  const selected = lines.slice(from, to + 1);
  if (!selected.some(line => line.kind !== "header")) return null;
  const coordinates = (key: "oldLine" | "newLine") => {
    const numbers = selected.flatMap(line => line[key] === null ? [] : [line[key]]);
    return !numbers.length ? "—" : numbers[0] === numbers.at(-1) ? `${numbers[0]}` : `${numbers[0]}–${numbers.at(-1)}`;
  };
  const quoted = appendTranscriptQuote(draft, `Review of ${JSON.stringify(path)} (old: ${coordinates("oldLine")}; new: ${coordinates("newLine")})\n${selected.map(line => line.content).join("\n")}`);
  if (quoted === null) return null;
  const next = `${quoted}${comment.replace(/\r\n?/g, "\n").trim()}\n\n`;
  return new TextEncoder().encode(next).length <= 64 * 1024 ? next : null;
}
