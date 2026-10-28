import { DocumentBody } from "@/components/DocumentReader";
import { useAppStore } from "@/store/app-store";

/**
 * A PDF, Word, Excel or PowerPoint file of the session's workspace (a project file or one an
 * agent wrote) in the file pane, read-only and through the bounded native reader (ADR-184).
 * `chrome` is false on the phone, whose page already names the file.
 */
export function WorkspaceDocument({ sessionId, path, chrome = true }: { sessionId: string; path: string; chrome?: boolean }) {
  const root = useAppStore((state) => state.sessions.find((session) => session.id === sessionId)?.worktree.path);
  const displayPath = root && path.startsWith(`${root.replace(/\/$/, "")}/`) ? path.slice(root.replace(/\/$/, "").length + 1) : path;
  return <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
    {chrome ? <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border-subtle px-2">
      <span className="min-w-0 flex-1 truncate font-mono ui-micro text-text-muted" title={path}>{displayPath}</span>
    </div> : null}
    <DocumentBody source={{ sessionId, path }} active zoom={1} />
  </div>;
}
