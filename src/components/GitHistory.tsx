import type { GitHistoryEntry } from "@/client/types";
import { ChevronDown } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";

/** Draw edges only to parent hashes actually present in this bounded ancestry. */
/** One row in pixels: the drawn graph and the text rows must share the same unit at every font scale. */
const ROW = 56;
export function GitHistory({ entries, truncated, onLoadMore, loading = false }: { entries: GitHistoryEntry[]; truncated: boolean; onLoadMore?: () => void; loading?: boolean }) {
  const t = useTranslation();
  const indexes = new Map(entries.map((entry, index) => [entry.hash, index]));
  const assigned = new Map<string, number>();
  const occupied = new Map<number, string>();
  const lanes = entries.map(entry => {
    let lane = assigned.get(entry.hash);
    if (lane === undefined) { lane = 0; while (occupied.has(lane)) lane++; assigned.set(entry.hash, lane); }
    occupied.delete(lane);
    for (const parent of entry.parents.filter(hash => indexes.has(hash))) {
      if (assigned.has(parent)) continue;
      let next = lane; while (occupied.has(next)) next++;
      assigned.set(parent, next); occupied.set(next, parent);
    }
    return lane;
  });
  const width = Math.max(36, (Math.max(0, ...lanes) + 1) * 16 + 12);
  return <details open className="changes-history shrink-0 border-t border-border-subtle">
    <summary className="changes-history-head ui-micro"><span>{t("workspaceGit.history")} <span className="text-text-muted">{entries.length}</span></span><ChevronDown size={13} aria-hidden="true" className="changes-history-chevron" /></summary>
    <p className="px-3 pb-2 ui-micro text-text-muted">{t("workspaceGit.historyHint")}</p>
    {entries.length ? <div className="scroll-thin flex max-h-[min(320px,32vh)] overflow-auto px-3 pb-2">
      <svg aria-hidden="true" width={width} height={entries.length * ROW} className="shrink-0 text-accent">
        {entries.flatMap((entry, index) => entry.parents.map(parent => {
          const target = indexes.get(parent);
          if (target === undefined || target <= index) return null;
          const x1 = 8 + lanes[index] * 16, x2 = 8 + lanes[target] * 16, y1 = index * ROW + 14, y2 = target * ROW + 14;
          return <path key={`${entry.hash}:${parent}`} d={`M${x1},${y1} C${x1},${y1 + 22} ${x2},${y2 - 22} ${x2},${y2}`} fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />;
        }))}
        {entries.map((entry, index) => <circle key={entry.hash} cx={8 + lanes[index] * 16} cy={index * ROW + 14} r="3" fill="currentColor" />)}
      </svg>
      <ol className="min-w-0 flex-1">
        {entries.map(entry => <li key={entry.hash} style={{ height: ROW }} className="min-w-0 overflow-hidden" title={`${entry.hash}\n${entry.author} · ${entry.authoredAt}\n${entry.parents.length ? entry.parents.map(hash => t("workspaceGit.parent", { hash })).join("\n") : t("workspaceGit.root")}`}>
          <p className="truncate ui-control text-text-primary">{entry.subject}</p>
          <p className="truncate ui-micro text-text-muted"><span className="font-mono">{entry.hash.slice(0, 8)}</span> · {entry.author}{entry.refs.length ? ` · ${entry.refs.join(", ")}` : ""}</p>
          <span className="sr-only">{entry.parents.map(hash => t("workspaceGit.parent", { hash })).join(", ")}</span>
        </li>)}
      </ol>
    </div> : <p className="px-3 pb-3 ui-caption text-text-muted">{t("workspaceGit.historyEmpty")}</p>}
    {truncated ? onLoadMore
      ? <div className="px-3 pb-2"><button type="button" className="ui-caption text-text-secondary hover:text-text-primary disabled:opacity-50" disabled={loading} onClick={onLoadMore}>{t(loading ? "workspaceGit.historyLoading" : "workspaceGit.historyMore")}</button></div>
      : <p className="px-3 pb-2 ui-caption text-text-muted">{t("workspaceGit.historyTruncated")}</p> : null}
  </details>;
}
