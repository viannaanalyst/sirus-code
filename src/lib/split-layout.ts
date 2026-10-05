/**
 * Side-by-side conversations: a binary tree of panes (memory-only view state).
 *
 * The active pane always shows the selected session, so the composer, dock,
 * Environment card and shortcuts keep following one session. The other panes
 * show their own conversation and become active when used.
 */
export type SplitEdge = "left" | "right" | "top" | "bottom" | "center";
export type SplitLeaf = { type: "leaf"; id: string; sessionId: string | null };
export type SplitBranch = { type: "split"; id: string; dir: "row" | "column"; ratio: number; a: SplitNode; b: SplitNode };
export type SplitNode = SplitLeaf | SplitBranch;
export interface SplitLayout { root: SplitNode; activeLeafId: string }
/** Where a dragged conversation would land; `root` splits the whole area. */
export interface SplitTarget { target: string; edge: SplitEdge }
export interface SplitRect { x: number; y: number; w: number; h: number }

export const SPLIT_MAX_PANES = 4;
export const SPLIT_MIN_RATIO = 0.2;

let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${++sequence}`;

export function initialSplit(sessionId: string | null = null): SplitLayout {
  const leaf: SplitLeaf = { type: "leaf", id: nextId("pane"), sessionId };
  return { root: leaf, activeLeafId: leaf.id };
}

export function splitLeaves(node: SplitNode, out: SplitLeaf[] = []): SplitLeaf[] {
  if (node.type === "leaf") out.push(node);
  else { splitLeaves(node.a, out); splitLeaves(node.b, out); }
  return out;
}

export const activeLeaf = (layout: SplitLayout) => splitLeaves(layout.root).find((leaf) => leaf.id === layout.activeLeafId) ?? splitLeaves(layout.root)[0];

function mapLeaves(node: SplitNode, map: (leaf: SplitLeaf) => SplitLeaf): SplitNode {
  if (node.type === "leaf") { const next = map(node); return next; }
  const a = mapLeaves(node.a, map), b = mapLeaves(node.b, map);
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

function removeNode(node: SplitNode, leafId: string): SplitNode | null {
  if (node.type === "leaf") return node.id === leafId ? null : node;
  const a = removeNode(node.a, leafId), b = removeNode(node.b, leafId);
  if (!a) return b;
  if (!b) return a;
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

function insertNode(node: SplitNode, target: string, edge: Exclude<SplitEdge, "center">, leaf: SplitLeaf): SplitNode {
  if (target === "root" || (node.type === "leaf" && node.id === target)) {
    const first = edge === "left" || edge === "top";
    return { type: "split", id: nextId("split"), dir: edge === "left" || edge === "right" ? "row" : "column", ratio: 0.5, a: first ? leaf : node, b: first ? node : leaf };
  }
  if (node.type === "leaf") return node;
  const a = insertNode(node.a, target, edge, leaf), b = insertNode(node.b, target, edge, leaf);
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

/** Removes a pane; when it was active, the pane that takes its space becomes active. */
export function splitRemove(layout: SplitLayout, leafId: string): SplitLayout {
  if (splitLeaves(layout.root).length < 2) return layout;
  const sibling = siblingOf(layout.root, leafId);
  const root = removeNode(layout.root, leafId);
  if (!root || root === layout.root) return layout;
  const activeLeafId = layout.activeLeafId === leafId ? (sibling ? splitLeaves(sibling)[0].id : splitLeaves(root)[0].id) : layout.activeLeafId;
  return { root, activeLeafId };
}

function siblingOf(node: SplitNode, leafId: string): SplitNode | null {
  if (node.type === "leaf") return null;
  if (node.a.type === "leaf" && node.a.id === leafId) return node.b;
  if (node.b.type === "leaf" && node.b.id === leafId) return node.a;
  return siblingOf(node.a, leafId) ?? siblingOf(node.b, leafId);
}

/** The pane already showing this session, if any. */
export const leafShowing = (layout: SplitLayout, sessionId: string) => splitLeaves(layout.root).find((leaf) => leaf.sessionId === sessionId) ?? null;

/** Whether dropping `sessionId` at `drop` changes anything, and whether the pane limit refuses it. */
export function splitDropState(layout: SplitLayout, sessionId: string, drop: SplitTarget): "ok" | "full" | "none" {
  const leaves = splitLeaves(layout.root);
  const from = leafShowing(layout, sessionId);
  if (from && from.id === drop.target) return "none";
  if (drop.target !== "root" && !leaves.some((leaf) => leaf.id === drop.target)) return "none";
  if (drop.edge === "center") return drop.target === "root" ? "none" : "ok";
  if (from) return leaves.length < 2 ? "none" : "ok";
  return leaves.length >= SPLIT_MAX_PANES ? "full" : "ok";
}

/**
 * Drops a conversation on a pane edge (new pane) or center (replace; a
 * conversation already open swaps places). The dropped pane becomes active.
 */
export function splitDrop(layout: SplitLayout, sessionId: string, drop: SplitTarget): SplitLayout {
  if (splitDropState(layout, sessionId, drop) !== "ok") return layout;
  const from = leafShowing(layout, sessionId);
  if (drop.edge === "center") {
    const replaced = splitLeaves(layout.root).find((leaf) => leaf.id === drop.target)!;
    const root = mapLeaves(layout.root, (leaf) => leaf.id === drop.target ? { ...leaf, sessionId } : from && leaf.id === from.id ? { ...leaf, sessionId: replaced.sessionId } : leaf);
    return { root, activeLeafId: drop.target };
  }
  const leaf: SplitLeaf = from ? { ...from } : { type: "leaf", id: nextId("pane"), sessionId };
  const base = from ? removeNode(layout.root, from.id) : layout.root;
  if (!base) return layout;
  return { root: insertNode(base, drop.target, drop.edge, leaf), activeLeafId: leaf.id };
}

/**
 * Keeps the layout in step with the selection: a selection already shown in a
 * pane activates that pane, otherwise the active pane switches to it. Panes of
 * deleted sessions close.
 */
export function splitSync(layout: SplitLayout, selectedSessionId: string | null, liveSessionIds: ReadonlySet<string>): SplitLayout {
  let next = layout;
  for (const leaf of splitLeaves(layout.root)) {
    if (leaf.id !== next.activeLeafId && leaf.sessionId && !liveSessionIds.has(leaf.sessionId)) next = splitRemove(next, leaf.id);
  }
  const active = activeLeaf(next);
  if (active.sessionId === selectedSessionId) return next;
  const shown = splitLeaves(next.root).find((leaf) => leaf.sessionId === selectedSessionId);
  if (shown) return { ...next, activeLeafId: shown.id };
  return { ...next, root: mapLeaves(next.root, (leaf) => leaf.id === active.id ? { ...leaf, sessionId: selectedSessionId } : leaf) };
}

export function splitResize(layout: SplitLayout, branchId: string, ratio: number): SplitLayout {
  const clamped = Math.min(1 - SPLIT_MIN_RATIO, Math.max(SPLIT_MIN_RATIO, ratio));
  const visit = (node: SplitNode): SplitNode => {
    if (node.type === "leaf") return node;
    if (node.id === branchId) return node.ratio === clamped ? node : { ...node, ratio: clamped };
    const a = visit(node.a), b = visit(node.b);
    return a === node.a && b === node.b ? node : { ...node, a, b };
  };
  const root = visit(layout.root);
  return root === layout.root ? layout : { ...layout, root };
}

/** Fractional pane and divider boxes (0–1) of the whole area. */
export function splitRects(node: SplitNode, rect: SplitRect = { x: 0, y: 0, w: 1, h: 1 }, panes = new Map<string, SplitRect>(), dividers: { branch: SplitBranch; rect: SplitRect }[] = []) {
  if (node.type === "leaf") { panes.set(node.id, rect); return { panes, dividers }; }
  const row = node.dir === "row";
  const a: SplitRect = row ? { ...rect, w: rect.w * node.ratio } : { ...rect, h: rect.h * node.ratio };
  const b: SplitRect = row ? { ...rect, x: rect.x + a.w, w: rect.w - a.w } : { ...rect, y: rect.y + a.h, h: rect.h - a.h };
  dividers.push({ branch: node, rect });
  splitRects(node.a, a, panes, dividers);
  splitRects(node.b, b, panes, dividers);
  return { panes, dividers };
}

/** Which part of a pane box a point is over: the middle replaces, otherwise the nearest edge. */
export function edgeAt(nx: number, ny: number): SplitEdge {
  if (Math.max(Math.abs(nx - 0.5), Math.abs(ny - 0.5)) < 0.2) return "center";
  const distances: [SplitEdge, number][] = [["left", nx], ["right", 1 - nx], ["top", ny], ["bottom", 1 - ny]];
  return distances.reduce((best, item) => item[1] < best[1] ? item : best)[0];
}
