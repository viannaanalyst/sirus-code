import type { AppSettings, Project } from "@/client/types";

/**
 * Pure pieces of the phone Home list (ADR-129): the long press that
 * opens a conversation's menu, that menu's items, where it opens, and the "Choose project" search.
 */

/** A press this long, without moving further than the slop, opens the row's menu. */
export const LONG_PRESS_MS = 450;
export const LONG_PRESS_SLOP = 10;

export interface LongPress {
  /** A finger (or the mouse) went down at this point. */
  start: (x: number, y: number) => void;
  /** It moved: past the slop it is a scroll or a swipe, not a long press. */
  move: (x: number, y: number) => void;
  /** It lifted or the gesture was taken over; true when the long press had fired. */
  end: () => boolean;
}

/** Times a long press. The timers are injectable so tests drive the clock. */
export function createLongPress(onFire: () => void, options: { delay?: number; slop?: number; setTimer?: (run: () => void, ms: number) => unknown; clearTimer?: (id: unknown) => void } = {}): LongPress {
  const { delay = LONG_PRESS_MS, slop = LONG_PRESS_SLOP } = options;
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = options.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let origin: { x: number; y: number } | null = null;
  let fired = false;
  const stop = () => { if (timer !== null) clearTimer(timer); timer = null; };
  return {
    start: (x, y) => {
      stop();
      fired = false;
      origin = { x, y };
      timer = setTimer(() => { timer = null; fired = true; onFire(); }, delay);
    },
    move: (x, y) => {
      if (!origin || timer === null) return;
      if (Math.hypot(x - origin.x, y - origin.y) > slop) stop();
    },
    end: () => {
      stop();
      origin = null;
      const was = fired;
      fired = false;
      return was;
    },
  };
}

/** A short tap of feedback where the browser offers it (Android); iOS Safari has none. */
export function hapticTick(target: { vibrate?: (pattern: number) => boolean } | undefined = globalThis.navigator) {
  if (typeof target?.vibrate !== "function") return;
  try { target.vibrate(10); } catch { /* not allowed here */ }
}

export type ThreadOrder = AppSettings["sidebarThreadSortOrder"];
export type RowMenuId = "copy-id" | "return" | "arrange" | "pin" | "unpin" | "rename" | "delete";

export interface RowMenuItem {
  id: RowMenuId;
  disabled?: boolean;
  destructive?: boolean;
  /** Opens a second card with these choices, the current one checked. */
  submenu?: { id: string; checked: boolean }[];
}

export interface RowMenuInput {
  /** Where the row is listed: Home offers "Arrange", snoozed rows their own way back. */
  place: "home" | "list" | "snoozed";
  pinned: boolean;
  /** Running or waiting: it cannot be deleted. */
  active: boolean;
  order: ThreadOrder;
}

/**
 * A conversation's long-press menu, in this order: copy the id, its lifecycle step
 * (return from snooze), arrange, pin, rename, delete.
 */
export function rowMenuItems(input: RowMenuInput): RowMenuItem[] {
  const listed = input.place === "home" || input.place === "list";
  const items: RowMenuItem[] = [{ id: "copy-id" }];
  if (input.place === "snoozed") items.push({ id: "return" });
  if (input.place === "home") items.push({ id: "arrange", submenu: (["updated_at", "created_at"] as const).map((id) => ({ id, checked: input.order === id })) });
  if (listed) items.push({ id: input.pinned ? "unpin" : "pin" });
  items.push({ id: "rename" });
  items.push({ id: "delete", destructive: true, disabled: input.active });
  return items;
}

/**
 * Where the menu card goes: under the pressed row, or above it when it would not fit before
 * the bottom of the screen; always kept inside the margins.
 */
export function contextMenuTop(row: { top: number; bottom: number }, menuHeight: number, viewportHeight: number, margin = 12, gap = 8): { top: number; above: boolean } {
  const below = row.bottom + gap;
  if (below + menuHeight <= viewportHeight - margin) return { top: below, above: false };
  const above = row.top - gap - menuHeight;
  if (above >= margin) return { top: above, above: true };
  // Neither fits whole (a tall row on a short screen): the side with more room, clamped.
  const roomBelow = viewportHeight - margin - below;
  const roomAbove = row.top - gap - margin;
  return roomBelow >= roomAbove
    ? { top: Math.max(margin, Math.min(below, viewportHeight - margin - menuHeight)), above: false }
    : { top: margin, above: true };
}

/** A project path as the picker shows it: the home folder as `~`, long paths cut in the middle. */
export function shortProjectPath(path: string, max = 40): string {
  const home = path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
  if (home.length <= max) return home;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return `${home.slice(0, head)}…${home.slice(home.length - (keep - head))}`;
}

/** Projects whose name or path holds every word of the query, in the given order. */
export function searchProjects(projects: readonly Project[], query: string): Project[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...projects];
  return projects.filter((project) => {
    const haystack = `${project.name} ${project.path}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** Shortens text in the middle ("feature/lo…-name"), keeping both ends readable. */
export function middleTruncate(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}

/** Longest branch shown on a Home row before it is shortened in the middle. */
export const ROW_BRANCH_MAX = 26;

export type RowDetail =
  | { kind: "project"; text: string }
  | { kind: "branch"; text: string; full: string }
  | { kind: "pullRequest"; text: string }
  | { kind: "computer" };

/**
 * The second line of a Home row (ADR-129, two-line rows): the project, the branch (shortened in
 * the middle, left out when unknown or detached), the pull request's number when known, and the
 * computer only when the phone knows more than one (`computer`, ADR-132).
 */
export function rowDetails(input: { projectName?: string | null; branch?: string | null; pullRequest?: number | null; computer?: boolean }, branchMax = ROW_BRANCH_MAX): RowDetail[] {
  const details: RowDetail[] = [];
  const project = input.projectName?.trim();
  if (project) details.push({ kind: "project", text: project });
  const branch = input.branch?.trim();
  if (branch && branch !== "HEAD") details.push({ kind: "branch", text: middleTruncate(branch, branchMax), full: branch });
  if (input.pullRequest && input.pullRequest > 0) details.push({ kind: "pullRequest", text: `#${input.pullRequest}` });
  if (input.computer) details.push({ kind: "computer" });
  return details;
}

/** Home's list filter (the dock's "List options"): one project, one computer, or everything. */
export interface HomeFilter { projectId: string | null; environmentId: string | null }

/**
 * The filter as it applies now: a stored project or computer that is no longer known (removed,
 * forgotten, or a single computer left) is ignored without being forgotten, so it comes back
 * once that data loads again.
 */
export function activeHomeFilter(stored: { projectId?: string | null; environmentId?: string | null }, known: { projectIds: readonly string[]; environmentIds: readonly string[]; multipleComputers: boolean }): HomeFilter {
  const projectId = stored.projectId && known.projectIds.includes(stored.projectId) ? stored.projectId : null;
  const environmentId = known.multipleComputers && stored.environmentId && known.environmentIds.includes(stored.environmentId) ? stored.environmentId : null;
  return { projectId, environmentId };
}

/** Conversations that pass Home's filter; `environmentOf` maps a conversation to its computer (the store's when missing). */
export function filterHomeSessions<T extends { id: string; projectId: string }>(sessions: readonly T[], filter: HomeFilter, environmentOf: ReadonlyMap<string, string>, storeId: string): T[] {
  if (!filter.projectId && !filter.environmentId) return [...sessions];
  return sessions.filter((session) => (!filter.projectId || session.projectId === filter.projectId)
    && (!filter.environmentId || (environmentOf.get(session.id) ?? storeId) === filter.environmentId));
}
