import { ContextMenu } from "@/components/arc/context-menu/context-menu";
import { ChevronRight, Copy, File, FilePlus, Folder, FolderPlus, FoldVertical, Search, Trash2 } from "@/components/icons/phosphor";
import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useAppStore } from "@/store/app-store";
import { useTranslation } from "@/i18n/use-translation";
import { client } from "@/client";
import type { FileEntry, WorkspaceEntryKind } from "@/client/types";
import { fileIconFor, folderIconFor } from "@/lib/file-icons";
import { formatUnknownError } from "@/lib/format-error";
import { IconButton } from "@/primitives/IconButton";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { emptyTypeahead, isTypeaheadKey, treeKeyAction, typeahead, type TreeKeyRow } from "@/lib/file-tree-keys";
import { FileSearchField, FileSearchResults, searchIsActive } from "@/components/FileSearch";

const ROOT = "workspace-root";
type Selection = { entry: FileEntry; parentPath?: string } | null;
type Creation = { kind: WorkspaceEntryKind; parentPath?: string };
/** The inline name field shown inside the target folder, like an editor explorer. */
type Draft = { creation: Creation; name: string; error: string | null; pending: boolean; input: RefObject<HTMLInputElement | null>; onName: (name: string) => void; onSubmit: () => void; onCancel: () => void };
type OpenFile = (path: string, line?: number, column?: number) => void;
type Props = { sessionId: string; rootLabel: string; onOpenFile?: OpenFile };

/** Rows inset their focus ring so the scroll edge never clips it. */
const ROW_FOCUS = "focus-visible:outline-offset-[-2px]";
/** Keys the tree owns even when they do nothing at the current row. */
const TREE_KEYS = new Set(["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Enter", " "]);

const rowOf = (item: HTMLElement): TreeKeyRow => ({
  name: item.dataset.name ?? "",
  level: Number(item.getAttribute("aria-level")) || 1,
  isDir: item.hasAttribute("aria-expanded"),
  expanded: item.getAttribute("aria-expanded") === "true",
});

export function FileTree(props: Props) {
  const workspacePath = useAppStore((state) => state.sessions.find((session) => session.id === props.sessionId)?.worktree.path);
  return <WorkspaceTree key={`${props.sessionId}:${workspacePath ?? ""}`} {...props} workspacePath={workspacePath} />;
}

function WorkspaceTree({ sessionId, rootLabel, workspacePath, onOpenFile: onOpenFileProp }: Props & { workspacePath?: string }) {
  const t = useTranslation();
  const [selected, setSelected] = useState<Selection>(null);
  const [expanded, setExpanded] = useState(() => new Set([ROOT]));
  const [refresh, setRefresh] = useState(0);
  const [creation, setCreation] = useState<Creation | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const live = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  const rootRow = useRef<HTMLButtonElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const tree = useRef<HTMLDivElement | null>(null);
  const typed = useRef(emptyTypeahead);
  // Rows are memoized; the open callback stays stable while the parent's prop changes.
  const openRef = useRef(onOpenFileProp);
  useLayoutEffect(() => { openRef.current = onOpenFileProp; });
  const onOpenFile = useCallback<OpenFile>((path, line, column) => openRef.current?.(path, line, column), []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const header = useRef<HTMLDivElement | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const results = useRef<HTMLDivElement | null>(null);
  const searching = searchOpen && searchIsActive(query);

  useLayoutEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  useEffect(() => { if (creation && !pending) input.current?.focus(); }, [creation, pending]);
  useEffect(() => { if (searchOpen) searchInput.current?.focus(); }, [searchOpen]);
  // Roving focus: exactly one row is tabbable. When the selection is hidden in a
  // collapsed folder, the root row takes the tab stop.
  useLayoutEffect(() => {
    const root = rootRow.current;
    if (!tree.current || !root) return;
    const stops = tree.current.querySelectorAll('[role="treeitem"][tabindex="0"]').length;
    if (stops === 0) root.tabIndex = 0;
    else if (stops > 1 && selected) root.tabIndex = -1;
  });
  useEffect(() => {
    if (!creation && !pending && restoreFocus.current) {
      restoreFocus.current = false;
      trigger.current?.focus();
    }
  }, [creation, pending]);

  const stillOwned = () => {
    const state = useAppStore.getState();
    const session = state.sessions.find((candidate) => candidate.id === sessionId);
    return live.current && Boolean(session && session.worktree.path === workspacePath && state.projects.some((project) => project.id === session.projectId));
  };
  const closeForm = () => {
    restoreFocus.current = true;
    setCreation(null);
    setError(null);
  };
  const startCreation = (kind: WorkspaceEntryKind, button: HTMLButtonElement) => {
    if (pendingRef.current) return;
    const parentPath = selected?.entry.isDir ? selected.entry.path : selected?.parentPath;
    trigger.current = button;
    setName("");
    setError(null);
    // The field appears inside the target folder, so that folder (and the root) must be open.
    setExpanded((previous) => new Set([...previous, ROOT, parentPath ?? ROOT]));
    setCreation({ kind, parentPath });
  };
  const submit = async () => {
    if (!creation || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    const destination = creation;
    try {
      const entry = await client.createWorkspaceEntry(sessionId, destination.kind, name, destination.parentPath);
      if (!stillOwned()) return;
      setExpanded((previous) => new Set([...previous, ROOT, destination.parentPath ?? ROOT]));
      setSelected({ entry, parentPath: destination.parentPath });
      setRefresh((previous) => previous + 1);
      closeForm();
      if (!entry.isDir) onOpenFile?.(entry.path);
    } catch (cause: unknown) {
      if (stillOwned()) { setError(formatUnknownError(cause)); input.current?.focus(); }
    } finally {
      pendingRef.current = false;
      if (stillOwned()) setPending(false);
    }
  };
  const [trashing, setTrashing] = useState<FileEntry | null>(null);
  const trash = async () => {
    const entry = trashing;
    if (!entry) return;
    try {
      await client.trashWorkspaceEntry(sessionId, entry.path);
      if (!stillOwned()) return;
      setSelected((current) => current && (current.entry.path === entry.path || current.entry.path.startsWith(`${entry.path}/`)) ? null : current);
      setRefresh((previous) => previous + 1);
    } catch (cause: unknown) {
      if (stillOwned()) setError(formatUnknownError(cause));
    }
  };
  const toggle = useCallback((path: string) => setExpanded((previous) => {
    const next = new Set(previous);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  }), []);

  /** Selects a row from its data attributes and moves focus to it. */
  const focusRow = (item: HTMLElement) => {
    const path = item.dataset.path;
    if (!path) setSelected(null);
    else if (item.hasAttribute("aria-expanded")) setSelected({ entry: { path, name: item.dataset.name ?? "", isDir: true } });
    else setSelected({ entry: { path, name: item.dataset.name ?? "", isDir: false }, parentPath: item.dataset.parent || undefined });
    item.focus();
  };
  // One listener for the whole tree; rows are read from the DOM only on a key press.
  const onTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // Inline name fields, retry buttons and context menus keep their own keys.
    if (target.getAttribute("role") !== "treeitem" || event.nativeEvent.isComposing || !tree.current) return;
    const items = [...tree.current.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const index = items.indexOf(target);
    if (index < 0) return;
    const rows = items.map(rowOf);
    if (isTypeaheadKey(event)) {
      event.preventDefault();
      const step = typeahead(typed.current, event.key, performance.now(), rows.map((row) => row.name), index);
      typed.current = step.state;
      if (step.index >= 0) focusRow(items[step.index]);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || !TREE_KEYS.has(event.key)) return;
    event.preventDefault();
    const scroller = tree.current.parentElement;
    const pageSize = scroller && target.offsetHeight ? scroller.clientHeight / target.offsetHeight : 10;
    const action = treeKeyAction(rows, index, event.key, pageSize);
    if (action.type === "none") return;
    const item = items[action.index];
    if (action.type === "focus") focusRow(item);
    else if (action.type === "expand" || action.type === "collapse") toggle(item.dataset.path || ROOT);
    // Same as a click: files open, folders toggle.
    else item.click();
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    header.current?.querySelector<HTMLButtonElement>("[data-file-search-toggle]")?.focus();
  };
  const enterResults = (open: boolean) => {
    const target = results.current?.querySelector<HTMLElement>(open ? "[data-search-match]" : "[data-search-result]");
    if (open) target?.click(); else target?.focus();
  };

  const draft: Draft | null = creation ? {
    creation, name, error, pending, input,
    onName: (value) => { setName(value); setError(null); },
    onSubmit: () => { if (name.trim()) void submit(); else if (!pendingRef.current) closeForm(); },
    onCancel: () => { if (!pendingRef.current) closeForm(); },
  } : null;

  return <div className="flex h-full min-h-0 flex-col">
    <div ref={header} role="group" aria-label={t("explorer.actions")} className="flex h-8 shrink-0 items-center justify-between gap-px border-b border-border-subtle px-1.5">
      <IconButton label={t("explorer.newFile")} disabled={pending} className="size-6 min-h-0 rounded-[6px] p-0" onClick={(event) => startCreation("file", event.currentTarget)}><FilePlus size={14} aria-hidden="true" /></IconButton>
      <IconButton label={t("explorer.newFolder")} disabled={pending} className="size-6 min-h-0 rounded-[6px] p-0" onClick={(event) => startCreation("directory", event.currentTarget)}><FolderPlus size={14} aria-hidden="true" /></IconButton>
      <IconButton label={t("explorer.collapseAll")} disabled={pending} className="size-6 min-h-0 rounded-[6px] p-0" onClick={() => { if (pendingRef.current) return; setExpanded(new Set([ROOT])); setSelected(null); closeForm(); restoreFocus.current = false; rootRow.current?.focus(); }}><FoldVertical size={14} aria-hidden="true" /></IconButton>
      <IconButton data-file-search-toggle="" label={t("explorer.search")} aria-expanded={searchOpen} aria-pressed={searchOpen}
        className={`size-6 min-h-0 rounded-[6px] p-0 ${searchOpen ? "bg-background-3 text-text-primary" : ""}`}
        onClick={() => { if (searchOpen) closeSearch(); else setSearchOpen(true); }}><Search size={14} aria-hidden="true" /></IconButton>
    </div>
    <FileSearchField open={searchOpen} query={query} caseSensitive={caseSensitive} input={searchInput}
      onQuery={setQuery} onCaseSensitive={setCaseSensitive} onClose={closeSearch} onEnterResults={enterResults} />
    {searching && workspacePath ? <FileSearchResults sessionId={sessionId} root={workspacePath} query={query} caseSensitive={caseSensitive}
      list={results} onOpen={onOpenFile} onClose={closeSearch} /> : null}
    <div className="scroll-thin min-h-0 flex-1 overflow-auto px-1 py-1.5" aria-busy={pending} hidden={searching && Boolean(workspacePath)}>
      <div ref={tree} role="tree" aria-label={rootLabel} onKeyDown={onTreeKeyDown}>
        <TreeDir sessionId={sessionId} onSelect={setSelected} onOpenFile={onOpenFile} selected={selected?.entry.path ?? null} name={rootLabel} depth={0} expanded={expanded} onToggle={toggle} refresh={refresh} rootRow={rootRow} draft={draft} onTrash={setTrashing} />
      </div>
    </div>
    <ConfirmDialog open={trashing !== null} onOpenChange={(open) => { if (!open) setTrashing(null); }}
      title={t(trashing?.isDir ? "explorer.trashFolderTitle" : "explorer.trashFileTitle", { name: trashing?.name ?? "" })}
      description={t("explorer.trashHelp")} confirmLabel={t("explorer.trash")} onConfirm={trash} />
    {error && !creation ? <p role="alert" className="px-2 py-1 ui-caption text-danger">{t(error)}</p> : null}
  </div>;
}

/** Inline name field: Enter creates, Escape (or leaving it empty) cancels. */
function DraftRow({ draft, depth }: { draft: Draft; depth: number }) {
  const t = useTranslation();
  const errorId = useId();
  const Icon = draft.creation.kind === "file" ? File : Folder;
  return <div role="none" style={{ paddingLeft: 24 + depth * 12 }} className="py-0.5 pr-1">
    <div className="flex h-7 items-center gap-1.5">
      <Icon size={13} aria-hidden="true" className="shrink-0 text-text-muted" />
      <input ref={draft.input} value={draft.name} maxLength={255} disabled={draft.pending} spellCheck={false} autoComplete="off"
        aria-label={t(draft.creation.kind === "file" ? "explorer.newFile" : "explorer.newFolder")} aria-invalid={Boolean(draft.error)} aria-describedby={draft.error ? errorId : undefined}
        placeholder={t(draft.creation.kind === "file" ? "explorer.fileName" : "explorer.folderName")}
        onChange={(event) => draft.onName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); draft.onSubmit(); }
          else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); draft.onCancel(); }
        }}
        onBlur={() => { if (!draft.name.trim()) draft.onCancel(); }}
        className="h-6 min-w-0 flex-1 rounded-[5px] border border-accent/70 bg-background-2 px-1.5 ui-control text-text-primary outline-none" />
    </div>
    {draft.error ? <p id={errorId} role="alert" className="pb-1 pl-5 ui-caption text-danger">{t(draft.error)}</p> : null}
  </div>;
}

type TreeProps = {
  sessionId: string; path?: string; parentPath?: string; name: string; depth: number; selected: string | null;
  onSelect: (selection: Selection) => void; onOpenFile?: OpenFile;
  expanded: Set<string>; onToggle: (path: string) => void; refresh: number;
  rootRow?: React.Ref<HTMLButtonElement>;
  draft?: Draft | null;
  onTrash?: (entry: FileEntry) => void;
};

function TreeDir({ sessionId, path, parentPath, name, depth, selected, onSelect, onOpenFile, expanded, onToggle, refresh, rootRow, draft, onTrash }: TreeProps) {
  const t = useTranslation();
  const open = expanded.has(path ?? ROOT);
  const [listing, setListing] = useState<{ entries: FileEntry[]; refresh: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const contentId = useId();
  const folder = folderIconFor(name, open);

  useEffect(() => {
    if (!open || listing?.refresh === refresh) return;
    let cancelled = false;
    client.listDir(sessionId, path).then((items) => {
      if (!cancelled) { setListing({ entries: items, refresh }); setError(null); }
    }).catch((cause: unknown) => { if (!cancelled) setError(formatUnknownError(cause)); });
    return () => { cancelled = true; };
  }, [open, path, sessionId, listing?.refresh, refresh, attempt]);

  const current = path ? selected === path : selected === null;
  const row = <button ref={rootRow} type="button" onClick={() => { onSelect(path ? { entry: { path, name, isDir: true } } : null); onToggle(path ?? ROOT); }}
    role="treeitem" aria-level={depth + 1} aria-expanded={open} aria-selected={current} aria-owns={contentId} tabIndex={current ? 0 : -1}
    data-path={path ?? ""} data-name={name} data-parent={parentPath ?? ""} title={path}
    style={{ paddingLeft: 8 + depth * 12 }}
    className={`flex h-7 w-full items-center gap-1 rounded-[6px] text-left ui-control ${ROW_FOCUS} ${path && selected === path ? "bg-background-3 text-text-primary" : "text-text-secondary hover:bg-background-3 hover:text-text-primary"}`}>
    <ChevronRight size={12} aria-hidden="true" className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
    <folder.Icon size={13} style={{ color: folder.color }} className="shrink-0" aria-hidden="true" />
    <span className="truncate">{name}</span>
  </button>;

  return <div role="none">
    {path && onTrash ? <ContextMenu activation="context-only" label={t("File actions")} items={[
      { id: "copy-path", label: t("Copy path"), icon: <Copy size={15} />, onSelect: () => { void navigator.clipboard.writeText(path).catch((error: unknown) => useAppStore.setState({ error: formatUnknownError(error) })); } },
      { id: "trash", label: t("explorer.trash"), icon: <Trash2 size={15} />, destructive: true, onSelect: () => onTrash({ path, name, isDir: true }) },
    ]}>
      {row}
    </ContextMenu> : row}
    <div id={contentId} role="group" hidden={!open}>
      {open ? <>
        {error ? <div className="px-3 ui-caption"><p role="alert" className="text-danger">{t(error)}</p><button type="button" className="text-accent" onClick={() => { setError(null); setAttempt((value) => value + 1); }}>{t("common.retry")}</button></div> : null}
        {draft && (draft.creation.parentPath ?? ROOT) === (path ?? ROOT) ? <DraftRow draft={draft} depth={depth} /> : null}
        {listing === null && !error ? <p className="px-3 ui-caption text-text-muted">{t("Carregando…")}</p> : null}
        {listing?.entries.map((entry) => entry.isDir
          ? <TreeDir key={entry.path} sessionId={sessionId} path={entry.path} parentPath={path} name={entry.name} depth={depth + 1} selected={selected} onSelect={onSelect} onOpenFile={onOpenFile} expanded={expanded} onToggle={onToggle} refresh={refresh} draft={draft} onTrash={onTrash} />
          : <FileRow key={entry.path} entry={entry} parentPath={path} depth={depth} selected={selected === entry.path} onSelect={onSelect} onOpenFile={onOpenFile} onTrash={onTrash} />)}
      </> : null}
    </div>
  </div>;
}

/** Memoized: moving the selection re-renders only the two rows whose state changed. */
const FileRow = memo(function FileRow({ entry, parentPath, depth, selected, onSelect, onOpenFile, onTrash }: {
  entry: FileEntry; parentPath?: string; depth: number; selected: boolean;
  onSelect: (selection: Selection) => void; onOpenFile?: OpenFile; onTrash?: (entry: FileEntry) => void;
}) {
  const t = useTranslation();
  const spec = fileIconFor(entry.name);
  return <ContextMenu activation="context-only" label={t("File actions")} items={[
    { id: "copy-path", label: t("Copy path"), icon: <Copy size={15} />, onSelect: () => { void navigator.clipboard.writeText(entry.path).catch((error: unknown) => useAppStore.setState({ error: formatUnknownError(error) })); } },
    ...(onTrash ? [{ id: "trash", label: t("explorer.trash"), icon: <Trash2 size={15} />, destructive: true, onSelect: () => onTrash(entry) }] : []),
  ]}>
    <button type="button" role="treeitem" aria-level={depth + 2} aria-selected={selected} tabIndex={selected ? 0 : -1}
      data-path={entry.path} data-name={entry.name} data-parent={parentPath ?? ""}
      onClick={() => { onSelect({ entry, parentPath }); onOpenFile?.(entry.path); }} title={entry.path}
      style={{ paddingLeft: 24 + depth * 12 }}
      className={`flex h-7 w-full items-center rounded-[6px] text-left ui-control ${ROW_FOCUS} ${selected ? "bg-background-3 text-text-primary" : "text-text-muted hover:bg-background-3"}`}>
      <spec.Icon size={13} style={{ color: spec.color }} className="mr-1.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{entry.name}</span>
    </button>
  </ContextMenu>;
});
