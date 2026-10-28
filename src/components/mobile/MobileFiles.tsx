import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileEntry, WorkspaceFileSuggestion } from "@/client/types";
import { client } from "@/client";
import { ChevronLeft, ChevronRight, LoaderCircle, Search, X } from "@/components/icons";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { isWorkspaceDocument } from "@/lib/document-reader";

const WorkspaceDocument = lazy(async () => ({ default: (await import("@/components/WorkspaceDocument")).WorkspaceDocument }));
import { usePhoneTranslation as useTranslation } from "./use-phone-host";
import { isLocalImageLink } from "@/lib/chat-markdown";
import { FileGlyph } from "@/components/FileGlyph";
import { formatUnknownError } from "@/lib/format-error";
import { sortEntries } from "@/lib/mobile";
import { visibleTreeRows, workspacePath } from "@/lib/phone-chat";
import { useAppStore } from "@/store/app-store";
import type { MobileNavigation } from "./MobileApp";

type Preview = { name: string; path: string; kind: "text" | "markdown"; content: string } | { name: string; path: string; kind: "image"; src: string } | { name: string; path: string; kind: "binary" } | { name: string; path: string; kind: "document" };

/**
 * The conversation's workspace on the phone (ADR-129): one tree
 * where a folder opens in place, a file opens its preview (code and text as monospace, Markdown
 * formatted, images as images), and a floating search field finds files by name. Read-only.
 */
export function MobileFiles({ sessionId, open, directory = false, navigation }: { sessionId: string; open?: string; directory?: boolean; navigation: MobileNavigation }) {
  const t = useTranslation();
  const session = useAppStore((state) => state.sessions.find((item) => item.id === sessionId));
  const project = useAppStore((state) => state.projects.find((item) => item.id === session?.projectId));
  const root = session?.worktree.path ?? "";
  const [top, setTop] = useState<FileEntry[] | null>(null);
  const [children, setChildren] = useState<Record<string, FileEntry[] | undefined>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ query: string; entries: WorkspaceFileSuggestion[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void client.listDir(sessionId).then((items) => { if (!cancelled) setTop(sortEntries(items)); }, (reason: unknown) => { if (!cancelled) { setTop([]); setError(formatUnknownError(reason)); } });
    return () => { cancelled = true; };
  }, [sessionId]);

  // Name search over the workspace (the composer's @file search), debounced while typing.
  const needle = query.trim();
  const projectId = session?.projectId ?? null;
  useEffect(() => {
    if (!needle || !projectId) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void client.workspaceFiles({ projectId, sessionId }, needle).then((found) => { if (!cancelled) setResults({ query: needle, entries: found.entries }); },
        (reason: unknown) => { if (!cancelled) { setResults({ query: needle, entries: [] }); setError(formatUnknownError(reason)); } });
    }, 150);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [needle, projectId, sessionId]);

  const loadChildren = useCallback(async (path: string) => {
    setLoading(path);
    try {
      const items = sortEntries(await client.listDir(sessionId, path));
      setChildren((current) => ({ ...current, [path]: items }));
    } catch (reason) {
      setError(formatUnknownError(reason));
    } finally {
      setLoading((current) => current === path ? null : current);
    }
  }, [sessionId]);
  const toggle = (entry: FileEntry) => {
    const open = !expanded.has(entry.path);
    setExpanded((current) => { const next = new Set(current); if (open) next.add(entry.path); else next.delete(entry.path); return next; });
    if (open && !children[entry.path]) void loadChildren(entry.path);
  };
  const openFile = async (entry: FileEntry) => {
    if (isWorkspaceDocument(entry.name)) { setPreview({ name: entry.name, path: entry.path, kind: "document" }); return; }
    setPreview({ name: entry.name, path: entry.path, kind: "text", content: "" });
    try {
      if (isLocalImageLink(entry.name)) { setPreview({ name: entry.name, path: entry.path, kind: "image", src: await client.replyImage(sessionId, entry.path) }); return; }
      const file = await client.readTextFile(sessionId, entry.path);
      setPreview(file.binary ? { name: entry.name, path: entry.path, kind: "binary" } : { name: entry.name, path: entry.path, kind: /\.(md|markdown)$/i.test(entry.name) ? "markdown" : "text", content: file.content });
    } catch (reason) {
      setPreview(null);
      setError(formatUnknownError(reason));
    }
  };
  /** A folder found by search opens in the tree with every folder above it. */
  const reveal = (relative: string) => {
    const parts = relative.split("/").filter(Boolean);
    const paths = parts.map((_, index) => workspacePath(root, parts.slice(0, index + 1).join("/")));
    setExpanded((current) => new Set([...current, ...paths]));
    for (const path of paths) if (!children[path]) void loadChildren(path);
    setQuery("");
    setResults(null);
  };
  // Opened from a file link in a reply: that file's preview (Back returns to the conversation),
  // or that folder in the tree.
  const direct = Boolean(open && !directory);
  const opened = useRef(false);
  useEffect(() => {
    if (!open || !root || opened.current) return;
    opened.current = true;
    if (directory) reveal(open);
    else void openFile({ name: open.split("/").pop() ?? open, path: workspacePath(root, open), isDir: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the workspace is known
  }, [open, root, directory]);
  const rows = useMemo(() => visibleTreeRows(top ?? [], children, expanded), [top, children, expanded]);
  const relative = (path: string) => path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  const back = () => { if (preview && !direct) setPreview(null); else navigation.back(); };
  const shown = results?.query === needle ? results.entries : null;

  return <div className="mobile-page mobile-files">
    <header className="mobile-bar">
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.back")} onClick={back}><ChevronLeft size={18} aria-hidden="true" /></button>
      <div className="mobile-bar-title"><h1>{preview?.name ?? t("mobile.files")}</h1><p>{preview ? relative(preview.path) : project?.name ?? session?.title}</p></div>
    </header>
    {preview ? <div className={`mobile-file-preview${preview.kind === "document" ? " is-document" : ""}`}>
      {preview.kind === "image" ? <img src={preview.src} alt={preview.name} className="mobile-file-image" />
        : preview.kind === "document" ? <Suspense fallback={null}><WorkspaceDocument sessionId={sessionId} path={preview.path} chrome={false} /></Suspense>
        : preview.kind === "binary" ? <p className="mobile-empty">{t("mobile.binaryFile")}</p>
        : preview.kind === "markdown" ? <div className="mobile-file-markdown"><MarkdownPreview source={preview.content} sessionId={sessionId} cwd={session?.worktree.path} /></div>
        : preview.content ? <pre className="mobile-file-text selectable">{preview.content}</pre>
        : <p className="mobile-empty"><LoaderCircle size={15} className="animate-spin" aria-hidden="true" /></p>}
    </div> : <>
      <div className="mobile-scroll mobile-files-scroll">
        {error ? <p role="alert" className="mobile-help text-danger">{error}</p> : null}
        {needle ? shown === null ? <p className="mobile-empty"><LoaderCircle size={15} className="animate-spin" aria-hidden="true" /></p>
          : shown.length ? <div className="mobile-tree" role="list">
            {shown.map((item) => {
              const name = item.path.split("/").filter(Boolean).at(-1) ?? item.path;
              const folder = item.path.split("/").slice(0, -1).join("/");
              const entry: FileEntry = { name, path: workspacePath(root, item.path), isDir: item.isDir };
              return <button key={item.path} type="button" role="listitem" className="mobile-tree-row" onClick={() => item.isDir ? reveal(item.path) : void openFile(entry)}>
                <span className="mobile-tree-chevron" aria-hidden="true" />
                <FileGlyph name={name} directory={item.isDir} size={18} />
                <span className="mobile-tree-text"><span className="mobile-tree-name">{name}</span>{folder ? <span className="mobile-tree-folder">{folder}</span> : null}</span>
              </button>;
            })}
          </div> : <p className="mobile-empty" role="status">{t("phoneChat.noFileMatches")}</p>
        : top === null ? <p className="mobile-empty"><LoaderCircle size={15} className="animate-spin" aria-hidden="true" /></p>
        : rows.length ? <div className="mobile-tree" role="tree" aria-label={t("mobile.files")}>
          {rows.map(({ entry, depth, expanded: open }) => <button key={entry.path} type="button" role="treeitem" aria-level={depth + 1} aria-expanded={entry.isDir ? open : undefined}
            className="mobile-tree-row" style={{ paddingLeft: 10 + depth * 18 }} onClick={() => entry.isDir ? toggle(entry) : void openFile(entry)}>
            <span className="mobile-tree-chevron" data-open={open || undefined} aria-hidden="true">
              {entry.isDir ? loading === entry.path ? <LoaderCircle size={13} className="animate-spin" /> : <ChevronRight size={13} /> : null}
            </span>
            <FileGlyph name={entry.name} directory={entry.isDir} open={open} size={18} />
            <span className="mobile-tree-name">{entry.name}</span>
          </button>)}
        </div> : <p className="mobile-empty">{t("mobile.emptyFolder")}</p>}
      </div>
      <label className="mobile-files-search mobile-glass">
        <Search size={16} aria-hidden="true" />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("phoneChat.searchFiles")} aria-label={t("phoneChat.searchFiles")} autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="search" />
        {query ? <button type="button" aria-label={t("Clear search")} onClick={() => { setQuery(""); setResults(null); }}><X size={14} aria-hidden="true" /></button> : null}
      </label>
    </>}
  </div>;
}
