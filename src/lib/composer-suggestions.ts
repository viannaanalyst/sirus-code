import { insertSkillInvocation } from "./skills";

export interface ComposerTrigger { kind: "skill" | "file"; query: string; start: number; end: number }

/** Only standalone tokens at a collapsed caret; URLs, emails and selections
 * retain normal editing. Quoted @paths support spaces without reading files. */
export function composerTrigger(value: string, start: number, end = start): ComposerTrigger | null {
  if (start !== end || start < 0 || start > value.length) return null;
  const match = /(?:^|\s)(\/[\w-]*|@(?:"(?:\\.|[^"\\\n])*|[^\s@"\n]*))$/.exec(value.slice(0, start));
  if (!match) return null;
  const token = match[1];
  const offset = start - token.length;
  const quoted = token.startsWith('@"');
  const remaining = value.slice(start);
  const suffix = quoted ? /^(?:\\.|[^"\\\n])*"?/.exec(remaining)?.[0] ?? "" : /^[^\s]*/.exec(remaining)?.[0] ?? "";
  return { kind: token[0] === "/" ? "skill" : "file", query: token.slice(quoted ? 2 : 1).replace(/\\"/g, '"'), start: offset, end: start + suffix.length };
}

export function completeComposerToken(value: string, trigger: ComposerTrigger, selected: string, directory = false): { value: string; caret: number } {
  if (trigger.kind === "skill") {
    const before = value.slice(0, trigger.start);
    const after = value.slice(trigger.end);
    // Native skill admission consumes leading invocations only. Selecting a
    // skill in prose moves its invocation to the front and preserves the prose.
    if (before.trim() && !/^\s*(?:\/[\w-]+\s+)*$/.test(before)) {
      const next = insertSkillInvocation(before + after, selected);
      return { value: next, caret: next.length };
    }
  }
  const path = directory ? `${selected}/` : selected;
  const quote = trigger.kind === "file" && /[\s"@]/.test(path);
  const token = trigger.kind === "skill" ? `/${selected}` : quote ? `@"${path.replace(/"/g, '\\"')}${directory ? "" : '"'}` : `@${path}`;
  const after = value.slice(trigger.end);
  const spacer = !directory && !/^\s/.test(after) ? " " : "";
  const next = value.slice(0, trigger.start) + token + spacer + after;
  return { value: next, caret: trigger.start + token.length + spacer.length };
}

export function suggestionIndex(current: number, delta: number, count: number): number {
  return count ? (current + delta + count) % count : 0;
}
