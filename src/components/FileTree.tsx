import { ContextMenu } from "@/components/arc/context-menu/context-menu";
import { ChevronRight, Copy, File, FilePlus, Folder, FolderPlus, FoldVertical, Trash2 } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useAppStore } from "@/store/app-store";
import { useTranslation } from "@/i18n/use-translation";
import { client } from "@/client";
import type { FileEntry, WorkspaceEntryKind } from "@/client/types";
import { fileIconFor, folderIconFor } from "@/lib/file-icons";
import { formatUnknownError } from "@/lib/format-error";
import { IconButton } from "@/primitives/IconButton";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";

const ROOT = "workspace-root";
type Selection = { entry: FileEntry; parentPath?: string } | null;
type Creation = { kind: WorkspaceEntryKind; parentPath?: string };
/** The inline name field shown inside the target folder, like an editor explorer. */
type Draft = { creation: Creation; name: string; error: string | null; pending: boolean; input: RefObject<HTMLInputElement | null>; onName: (name: string) => void; onSubmit: () => void; onCancel: () => void };
type Props = { sessionId: string; rootLabel: string; onOpenFile?: (path: string) => void };

export function FileTree(props: Props) {
  const workspacePath = useAppStore((state) => state.sessions.find((session) => session.id === props.sessionId)?.worktree.path);
  return <WorkspaceTree key={`${props.sessionId}:${workspacePath ?? ""}`} {...props} workspacePath={workspacePath} />;
}

function WorkspaceTree({ sessionId, rootLabel, workspacePath, onOpenFile }: Props & { workspacePath?: string }) {
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

  useLayoutEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  useEffect(() => { if (creation && !pending) input.current?.focus(); }, [creation, pending]);
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
  const toggle = (path: string) => setExpanded((previous) => {
    const next = new Set(previous);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });

  const draft: Draft | null = creation ? {
    creation, name, error, pending, input,
    onName: (value) => { setName(value); setError(null); },
    onSubmit: () => { if (name.trim()) void submit(); else if (!pendingRef.current) closeForm(); },
    onCancel: () => { if (!pendingRef.current) closeForm(); },
  } : null;

  return <div className="flex h-full min-h-0 flex-col">
    <div role="group" aria-label={t("explorer.actions")} className="flex h-8 shrink-0 items-center justify-end gap-px border-b border-border-subtle px-1.5">
      <IconButton label={t("explorer.newFile")} disabled={pending} className="size-6 min-h-0 rounded-[6px] p-0" onClick={(event) => startCreation("file", event.currentTarget)}><FilePlus size={14} aria-hidden="true" /></IconButton>
      <IconButton label={t("explorer.newFolder")} disabled={pending} className="size-6 min-h-0 rounded-[6px] p-0" onClick={(event) => startCreation("directory", event.currentTarget)}><FolderPlus size={14} aria-hidden="true" /></IconButton>
      <IconButton label={t("explorer.collapseAll")} disabled={pending} className="size-6 min-h-0 rounded-[6px] p-0" onClick={() => { if (pendingRef.current) return; setExpanded(new Set([ROOT])); setSelected(null); closeForm(); restoreFocus.current = false; rootRow.current?.focus(); }}><FoldVertical size={14} aria-hidden="true" /></IconButton>
    </div>
    <div className="scroll-thin min-h-0 flex-1 overflow-auto px-1 py-1.5" aria-busy={pending}>
      <TreeDir sessionId={sessionId} onSelect={setSelected} onOpenFile={onOpenFile} selected={selected?.entry.path ?? null} name={rootLabel} depth={0} expanded={expanded} onToggle={toggle} refresh={refresh} rootRow={rootRow} draft={draft} onTrash={setTrashing} />
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
  return <div style={{ paddingLeft: 24 + depth * 12 }} className="py-0.5 pr-1">
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
  sessionId: string; path?: string; name: string; depth: number; selected: string | null;
  onSelect: (selection: Selection) => void; onOpenFile?: (path: string) => void;
  expanded: Set<string>; onToggle: (path: string) => void; refresh: number;
  rootRow?: React.Ref<HTMLButtonElement>;
  draft?: Draft | null;
  onTrash?: (entry: FileEntry) => void;
};

function TreeDir({ sessionId, path, name, depth, selected, onSelect, onOpenFile, expanded, onToggle, refresh, rootRow, draft, onTrash }: TreeProps) {
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

  return <div>
    {path && onTrash ? <ContextMenu activation="context-only" label={t("File actions")} items={[
      { id: "copy-path", label: t("Copy path"), icon: <Copy size={14} />, onSelect: () => { void navigator.clipboard.writeText(path).catch((error: unknown) => useAppStore.setState({ error: formatUnknownError(error) })); } },
      { id: "trash", label: t("explorer.trash"), icon: <Trash2 size={14} />, onSelect: () => onTrash({ path, name, isDir: true }) },
    ]}>
      <button ref={rootRow} type="button" onClick={() => { onSelect(path ? { entry: { path, name, isDir: true } } : null); onToggle(path ?? ROOT); }}
      aria-expanded={open} aria-controls={contentId} aria-pressed={path ? selected === path : selected === null} title={path}
      style={{ paddingLeft: 8 + depth * 12 }}
      className={`flex h-7 w-full items-center gap-1 rounded-[6px] text-left ui-control ${path && selected === path ? "bg-background-3 text-text-primary" : "text-text-secondary hover:bg-background-3 hover:text-text-primary"}`}>
      <ChevronRight size={12} aria-hidden="true" className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
      <folder.Icon size={13} style={{ color: folder.color }} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{name}</span>
    </button>
    </ContextMenu> : <>
    <button ref={rootRow} type="button" onClick={() => { onSelect(path ? { entry: { path, name, isDir: true } } : null); onToggle(path ?? ROOT); }}
      aria-expanded={open} aria-controls={contentId} aria-pressed={path ? selected === path : selected === null} title={path}
      style={{ paddingLeft: 8 + depth * 12 }}
      className={`flex h-7 w-full items-center gap-1 rounded-[6px] text-left ui-control ${path && selected === path ? "bg-background-3 text-text-primary" : "text-text-secondary hover:bg-background-3 hover:text-text-primary"}`}>
      <ChevronRight size={12} aria-hidden="true" className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
      <folder.Icon size={13} style={{ color: folder.color }} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{name}</span>
    </button>
    </>}
    <div id={contentId} hidden={!open}>
      {open ? <>
        {error ? <div className="px-3 ui-caption"><p role="alert" className="text-danger">{t(error)}</p><button type="button" className="text-accent" onClick={() => { setError(null); setAttempt((value) => value + 1); }}>{t("common.retry")}</button></div> : null}
        {draft && (draft.creation.parentPath ?? ROOT) === (path ?? ROOT) ? <DraftRow draft={draft} depth={depth} /> : null}
        {listing === null && !error ? <p className="px-3 ui-caption text-text-muted">{t("Carregando…")}</p> : null}
        {listing?.entries.map((entry) => entry.isDir
          ? <TreeDir key={entry.path} sessionId={sessionId} path={entry.path} name={entry.name} depth={depth + 1} selected={selected} onSelect={onSelect} onOpenFile={onOpenFile} expanded={expanded} onToggle={onToggle} refresh={refresh} draft={draft} onTrash={onTrash} />
          : <FileRow key={entry.path} entry={entry} parentPath={path} depth={depth} selected={selected} onSelect={onSelect} onOpenFile={onOpenFile} onTrash={onTrash} />)}
      </> : null}
    </div>
  </div>;
}

function FileRow({ entry, parentPath, depth, selected, onSelect, onOpenFile, onTrash }: {
  entry: FileEntry; parentPath?: string; depth: number; selected: string | null;
  onSelect: (selection: Selection) => void; onOpenFile?: (path: string) => void; onTrash?: (entry: FileEntry) => void;
}) {
  const t = useTranslation();
  const spec = fileIconFor(entry.name);
  return <ContextMenu activation="context-only" label={t("File actions")} items={[
    { id: "copy-path", label: t("Copy path"), icon: <Copy size={14} />, onSelect: () => { void navigator.clipboard.writeText(entry.path).catch((error: unknown) => useAppStore.setState({ error: formatUnknownError(error) })); } },
    ...(onTrash ? [{ id: "trash", label: t("explorer.trash"), icon: <Trash2 size={14} />, onSelect: () => onTrash(entry) }] : []),
  ]}>
    <button type="button" aria-pressed={selected === entry.path} onClick={() => { onSelect({ entry, parentPath }); onOpenFile?.(entry.path); }} title={entry.path}
      style={{ paddingLeft: 24 + depth * 12 }}
      className={`flex h-7 w-full items-center rounded-[6px] text-left ui-control ${selected === entry.path ? "bg-background-3 text-text-primary" : "text-text-muted hover:bg-background-3"}`}>
      <spec.Icon size={13} style={{ color: spec.color }} className="mr-1.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{entry.name}</span>
    </button>
  </ContextMenu>;
}
