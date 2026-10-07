import type { ActivityItem } from "@/client/types";

/**
 * A turn as T3 Code shows it: reply text and tool work in the order they happened.
 * Rows carry the reply length when they began (`offset`); back-to-back rows form one
 * work group. Rows from turns recorded before offsets existed sit at the start.
 */
export type TimelinePart =
  | { kind: "text"; start: number; end: number }
  | { kind: "steer"; text: string }
  | { kind: "work"; items: ActivityItem[] };

export function timelineParts(content: string, items: readonly ActivityItem[], steers: readonly { offset: number; text: string }[] = []): TimelinePart[] {
  type Event = { at: number; order: number; item?: ActivityItem; steer?: string };
  const clamp = (at: number | undefined) => Math.max(0, Math.min(at ?? 0, content.length));
  const events: Event[] = [
    ...items.map((item, order) => ({ at: clamp(item.offset), order, item })),
    ...steers.map((steer, order) => ({ at: clamp(steer.offset), order: items.length + order, steer: steer.text })),
  ].sort((a, b) => a.at - b.at || a.order - b.order);
  const parts: TimelinePart[] = [];
  let cursor = 0;
  const text = (end: number) => {
    // Whitespace between two pieces of work does not split their group.
    if (end > cursor && content.slice(cursor, end).trim()) parts.push({ kind: "text", start: cursor, end });
    cursor = Math.max(cursor, end);
  };
  for (const event of events) {
    text(event.at);
    if (event.item) {
      const last = parts.at(-1);
      if (last?.kind === "work") last.items.push(event.item);
      else parts.push({ kind: "work", items: [event.item] });
    } else {
      parts.push({ kind: "steer", text: event.steer! });
      // The reply resumes after the instruction without the blank lines between its items.
      while (content[cursor] === "\n") cursor += 1;
    }
  }
  text(content.length);
  return parts;
}

/** The parts a finished turn folds away: everything before its final answer (the text after the last work). */
export function foldBoundary(parts: readonly TimelinePart[]): number {
  let index = parts.length;
  while (index > 0 && parts[index - 1].kind === "text") index -= 1;
  return index;
}

export type StepCategory = "skill" | "edit" | "command" | "read" | "search" | "web" | "tool" | "agent";

export function stepCategory(item: Pick<ActivityItem, "kind" | "label" | "detail">): StepCategory {
  if (item.kind === "read") {
    if (item.label === "Web search") return "web";
    const detail = item.detail ?? "";
    // Globs and regex are searches; an absolute or relative path is a read even with spaces in it
    // ("Application Support"); otherwise a bare file name reads and a phrase searches.
    if (!detail || /[*?[\]{}|^$\\]/.test(detail)) return "search";
    if (/^(?:\/|~\/|\.{1,2}\/)/.test(detail)) return "read";
    return !/\s/.test(detail) && /[./]/.test(detail) ? "read" : "search";
  }
  return item.kind === "skill" ? "skill" : item.kind === "edit" ? "edit" : item.kind === "command" ? "command" : item.kind === "agent" ? "agent" : "tool";
}

/** A detail as shown: workspace paths become relative, long ones keep their end. */
export function stepDetail(detail: string | undefined, cwd?: string): string {
  let value = (detail ?? "").trim();
  if (cwd && value.startsWith(`${cwd}/`)) value = value.slice(cwd.length + 1);
  return value.length > 72 ? `…${value.slice(-71)}` : value;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** One step in a sentence: "Leu src/app.ts", or "Lendo src/app.ts…" while it runs. */
export function stepSentence(item: ActivityItem, t: Translate, cwd?: string): string {
  const category = stepCategory(item);
  const detail = stepDetail(item.detail, cwd);
  const live = item.state === "running";
  if (category === "skill") return t("timeline.done.skill");
  if (category === "agent") return item.label || t("Subagent");
  if (!detail) return t(`timeline.${live ? "plainLive" : "plain"}.${category}`);
  return t(`timeline.${live ? "live" : "done"}.${category}`, { detail });
}

/** Back-to-back steps as one sentence, T3's way: at most two counted kinds (skills, edits and commands first), then the rest. */
export function groupSentence(items: readonly ActivityItem[], t: Translate): string {
  const order: StepCategory[] = ["skill", "edit", "command", "read", "search", "web", "agent", "tool"];
  const counts = new Map<StepCategory, Set<string>>();
  for (const item of items) {
    const category = stepCategory(item);
    // Files count once however often they were touched; other steps count each time.
    const key = (category === "read" || category === "edit") && item.detail ? item.detail : item.id;
    counts.set(category, (counts.get(category) ?? new Set()).add(key));
  }
  const present = order.filter((category) => counts.has(category));
  const shown = present.slice(0, 2);
  const phrases = shown.map((category) => { const count = counts.get(category)!.size; return t(count === 1 ? `timeline.count.${category}.one` : `timeline.count.${category}`, { count }); });
  const rest = present.slice(2).reduce((sum, category) => sum + counts.get(category)!.size, 0);
  let sentence = phrases.length === 2 && !rest ? `${phrases[0]} ${t("timeline.and")} ${phrases[1]}` : phrases.join(", ");
  if (rest) sentence += ` ${t(rest === 1 ? "timeline.more.one" : "timeline.more", { count: rest })}`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
