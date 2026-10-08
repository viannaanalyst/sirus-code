import { useMemo } from "react";
import type { GitHistoryEntry } from "@/client/types";
import { ChevronDown, GitBranch } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { graphCommitFromDecorations, GRAPH_ROW_PX, historyItemGraph, layoutGitGraph, type GraphRef } from "@/lib/git-graph";

/**
 * Commit history as MonoCode draws it (ADR-091): one 22px row per commit with its own
 * lane SVG, a colour per branch, curved merges, a ringed HEAD and the first ref as a pill.
 */
export function GitHistory({ entries, truncated, onLoadMore, loading = false }: { entries: GitHistoryEntry[]; truncated: boolean; onLoadMore?: () => void; loading?: boolean }) {
  const t = useTranslation();
  const rows = useMemo(() => layoutGitGraph(entries.map((entry) => graphCommitFromDecorations(entry.hash, entry.parents, entry.refs))), [entries]);
  return <details open className="changes-history shrink-0 border-t border-border-subtle">
    <summary className="changes-history-head ui-micro"><span>{t("workspaceGit.history")} <span className="text-text-muted">{entries.length}</span></span><ChevronDown size={13} aria-hidden="true" className="changes-history-chevron" /></summary>
    {entries.length ? <ol className="scroll-thin git-graph max-h-[min(360px,36vh)] overflow-y-auto overflow-x-hidden pb-2">
      {entries.map((entry, index) => {
        const row = rows[index];
        if (!row) return null;
        const graph = historyItemGraph(row);
        const pill = row.refs.find((ref) => ref.kind === "tag") ?? row.refs.find((ref) => ref.color) ?? row.refs[0];
        return <li key={entry.hash} style={{ height: GRAPH_ROW_PX }} className={row.kind === "HEAD" ? "git-graph-row is-head" : "git-graph-row"}
          title={`${entry.hash.slice(0, 8)} ${entry.subject}\n${entry.author} · ${entry.authoredAt}\n${entry.parents.length ? entry.parents.map((hash) => t("workspaceGit.parent", { hash })).join("\n") : t("workspaceGit.root")}`}>
          <svg aria-hidden="true" width={graph.width} height={graph.height} className="git-graph-lanes">
            {graph.paths.map((path, pathIndex) => <path key={pathIndex} d={path.d} fill="none" stroke={path.color} strokeWidth={path.strokeWidth} strokeLinecap="round" />)}
            {graph.circles.map((circle, circleIndex) => <circle key={circleIndex} cx={circle.cx} cy={circle.cy} r={circle.r} fill={circle.fill ?? "none"} strokeWidth={circle.strokeWidth} />)}
          </svg>
          <span className="git-graph-text">
            <span className="git-graph-subject">{entry.subject || entry.hash.slice(0, 8)}</span>
            {entry.author ? <span className="git-graph-author">{entry.author}</span> : null}
          </span>
          {pill ? <RefPill value={pill} /> : null}
          <span className="sr-only">{entry.parents.map((hash) => t("workspaceGit.parent", { hash })).join(", ")}</span>
        </li>;
      })}
    </ol> : <p className="px-3 pb-3 ui-caption text-text-muted">{t("workspaceGit.historyEmpty")}</p>}
    {truncated ? onLoadMore
      ? <div className="px-3 pb-2"><button type="button" className="ui-caption text-text-secondary hover:text-text-primary disabled:opacity-50" disabled={loading} onClick={onLoadMore}>{t(loading ? "workspaceGit.historyLoading" : "workspaceGit.historyMore")}</button></div>
      : <p className="px-3 pb-2 ui-caption text-text-muted">{t("workspaceGit.historyTruncated")}</p> : null}
  </details>;
}

function RefPill({ value }: { value: GraphRef }) {
  return <span className="git-graph-pill" data-plain={!value.color || undefined} style={value.color ? { backgroundColor: value.color } : undefined}>
    {value.kind === "local" ? <GitBranch size={10} aria-hidden="true" /> : null}
    <span className="truncate">{value.name}</span>
  </span>;
}
