/** "Close all tabs" in the right dock: which panes close, and whether to ask first. */

export interface DockCloseCandidate {
  id: string;
  /** An editor pane whose file has unsaved changes. */
  dirty: boolean;
  /** An editor pane whose file is being written; a single close waits for it, so the batch leaves it open. */
  saving: boolean;
}

export interface DockCloseAllPlan {
  /** Pane ids to close, right to left, so each one is remembered at its real position for ⇧⌘T. */
  close: string[];
  /** How many of them would discard unsaved changes. */
  dirty: number;
  /** Panes left open because their file is still saving. */
  skipped: number;
}

export function planDockCloseAll(panes: readonly DockCloseCandidate[]): DockCloseAllPlan {
  const close: string[] = [];
  let dirty = 0;
  let skipped = 0;
  for (let index = panes.length - 1; index >= 0; index--) {
    const pane = panes[index];
    if (pane.saving) { skipped++; continue; }
    if (pane.dirty) dirty++;
    close.push(pane.id);
  }
  return { close, dirty, skipped };
}

/** The confirmation to show once for the whole batch, or null to close right away. */
export function dockCloseAllPrompt(plan: DockCloseAllPlan): { key: "dock.closeAllDirtyOne" | "dock.closeAllDirty"; params: { count: number } } | null {
  if (plan.close.length === 0 || plan.dirty === 0) return null;
  return { key: plan.dirty === 1 ? "dock.closeAllDirtyOne" : "dock.closeAllDirty", params: { count: plan.dirty } };
}
