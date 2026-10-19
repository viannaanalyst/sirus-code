import type { ChangeKind, GitWorkspaceEntry } from "@/client/types";

/** One native step that discards part of a path. Mirrors `discard_steps` in git_workspace.rs. */
export type DiscardStep = "restoreStaged" | "restoreWorktree" | "removeFromIndex" | "deleteFile";

/**
 * The steps for one path from its staged and unstaged kinds (null when the side has no change).
 * Null means the combination is refused natively, so the caller must not offer the action.
 */
export function discardSteps(staged: ChangeKind | null, unstaged: ChangeKind | null): DiscardStep[] | null {
  const tracked = unstaged === null || unstaged === "modified" || unstaged === "deleted";
  if (staged === "added" && tracked) return ["removeFromIndex", "deleteFile"];
  if ((staged === "modified" || staged === "deleted") && tracked) return ["restoreStaged", "restoreWorktree"];
  if (staged === null && unstaged === "untracked") return ["deleteFile"];
  if (staged === null && (unstaged === "modified" || unstaged === "deleted")) return ["restoreWorktree"];
  return null;
}

export interface DiscardPlan {
  files: { path: string; steps: DiscardStep[] }[];
  /** New or untracked files that will be deleted from disk. */
  deletes: number;
}

/**
 * The plan for discarding `paths`, looked up in the snapshot's entries. Null when any path is
 * missing, not actionable (linked, submodule or conflicted) or has no plan.
 */
export function discardPlan(paths: string[], staged: GitWorkspaceEntry[], unstaged: GitWorkspaceEntry[]): DiscardPlan | null {
  if (!paths.length) return null;
  const files: DiscardPlan["files"] = [];
  for (const path of new Set(paths)) {
    const stagedEntry = staged.find(entry => entry.path === path);
    const unstagedEntry = unstaged.find(entry => entry.path === path);
    const entries = [stagedEntry, unstagedEntry].filter((entry): entry is GitWorkspaceEntry => Boolean(entry));
    if (!entries.length || entries.some(entry => !entry.actionable)) return null;
    const steps = discardSteps(stagedEntry?.kind ?? null, unstagedEntry?.kind ?? null);
    if (!steps) return null;
    files.push({ path, steps });
  }
  return { files, deletes: files.filter(file => file.steps.includes("deleteFile")).length };
}
