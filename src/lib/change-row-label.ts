/**
 * Accessible name for a changed-file row in the Changes lists (dock Changes pane, turn summary,
 * review file list). The whole row is one control, so its name carries the full path, the kind
 * and the +/− counts that are otherwise only visible.
 */
export function changeRowLabel({ action, path, kind, additions, deletions, status }: { action?: string; path: string; kind?: string; additions?: number; deletions?: number; status?: string }): string {
  const counts = status ?? (additions !== undefined || deletions !== undefined ? `+${additions ?? 0} −${deletions ?? 0}` : "");
  return [action ?? path, kind, counts].filter(Boolean).join(", ");
}
