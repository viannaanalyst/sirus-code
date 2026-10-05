/** Customizable rail items (ADR-052). Settings stays fixed at the bottom. */
export const RAIL_ITEMS = ["home", "inbox", "kanban", "tasks", "archived", "pulls", "automations", "drafts"] as const;
export type RailItem = (typeof RAIL_ITEMS)[number];
/** Main views that are pages of their own (the rail highlights only that item). */
export const PAGE_ITEMS = ["inbox", "tasks", "pulls", "automations"] as const;
export const RAIL_LABELS: Record<RailItem, string> = {
  home: "Home", inbox: "inbox.title", kanban: "Kanban", tasks: "tasks.title", archived: "Archived sessions",
  pulls: "pulls.title", automations: "automations.title", drafts: "Drafts",
};

/** Saved order first (unknown IDs dropped), then any item the saved order lacks, in default order. */
export function railOrder(saved: readonly string[]): RailItem[] {
  const known = saved.filter((id): id is RailItem => (RAIL_ITEMS as readonly string[]).includes(id));
  const unique = [...new Set(known)];
  return [...unique, ...RAIL_ITEMS.filter((id) => !unique.includes(id))];
}

/** Hidden items stay visible while they are the current page; Home is never hidden. */
export function visibleRail(saved: readonly string[], hidden: readonly string[], current: string): RailItem[] {
  return railOrder(saved).filter((id) => id === "home" || id === current || !hidden.includes(id));
}

export function moveRailItem(order: readonly RailItem[], id: RailItem, to: number): RailItem[] {
  const next = order.filter((item) => item !== id);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, id);
  return next;
}
