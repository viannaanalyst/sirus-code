import type { ScriptRun, Session, WorktreeRelease } from "@/client/types";

/** The run to show above the composer: a running one first, else the most recent. */
export function visibleScriptRun(session: Pick<Session, "scripts"> | null | undefined): ScriptRun | null {
  const runs = session?.scripts?.runs ?? [];
  return runs.find((run) => run.status === "running") ?? [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
}

/** Disk space in binary units, one decimal from 10 down. */
export function formatDiskSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${unit === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Translation key and values describing why an archived session's worktree was kept or removed. */
export function worktreeReleaseText(release: WorktreeRelease): { title: string; description: string; values: Record<string, string> } {
  if (release.outcome === "released") return { title: "worktreeRelease.released", description: "worktreeRelease.releasedHelp", values: { branch: release.branch } };
  if (release.outcome === "kept") return { title: "worktreeRelease.kept", description: `worktreeRelease.${release.reason}`, values: { branch: release.branch } };
  return { title: "worktreeRelease.released", description: "", values: {} };
}
