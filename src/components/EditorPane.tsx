import { useEffect, useState } from "react";
import { ChevronDown, Eye, FileCode2, FolderOpen, Hammer, MousePointer2, SquareCode, SquareTerminal, X } from "@/components/icons/phosphor";
import { client } from "@/client";
import type { EditorId, TextFileSnapshot } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { editorKey } from "@/lib/editor-state";
import { useAppStore } from "@/store/app-store";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/primitives/Dropdown";
import { CodeEditor, languageForPath, type EditorReveal } from "@/components/editor/CodeEditor";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { MarkdownPreview } from "@/components/MarkdownPreview";

const fallbackEditorIcons: Record<EditorId, typeof FolderOpen> = {
  finder: FolderOpen,
  terminal: SquareTerminal,
  cursor: MousePointer2,
  vscode: FileCode2,
  xcode: Hammer,
};

function EditorMark({ id, png }: { id: EditorId; png?: string }) {
  const Fallback = fallbackEditorIcons[id];
  return <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
    {png ? <img src={`data:image/png;base64,${png}`} alt="" className="size-4" /> : <Fallback size={14} />}
  </span>;
}

/** Mounted views per buffer: a clean buffer is released when its last view closes. */
const openViews = new Map<string, number>();

export function EditorPane({ sessionId, path, reveal, onClose }: { sessionId: string; path: string; reveal?: EditorReveal; onClose?: () => void }) {
  const t = useTranslation();
  const key = editorKey(sessionId, path);
  const buffer = useAppStore((state) => state.editorBuffers[key]);
  const setEditorBuffer = useAppStore((state) => state.setEditorBuffer);
  const editors = useAppStore((state) => state.editors);
  const editorIcons = useAppStore((state) => state.editorIcons);
  const loadEditors = useAppStore((state) => state.loadEditors);
  const [snapshot, setSnapshot] = useState<TextFileSnapshot | null>(null);
  const saving = useAppStore(state => !!state.editorSaving[key]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false);
  const [view, setView] = useState<"code" | "preview">("code");
  const isMarkdown = /\.(md|markdown|mdx)$/i.test(path);
  const installed = (editors ?? []).filter((editor) => editor.installed);

  useEffect(() => {
    void loadEditors();
  }, [loadEditors]);

  useEffect(() => {
    setView("code");
  }, [path]);

  useEffect(() => {
    openViews.set(key, (openViews.get(key) ?? 0) + 1);
    return () => {
      const remaining = (openViews.get(key) ?? 1) - 1;
      if (remaining > 0) { openViews.set(key, remaining); return; }
      openViews.delete(key);
      // Unsaved edits stay; a clean file is read again from disk when reopened.
      const state = useAppStore.getState();
      const buffer = state.editorBuffers[key];
      if (buffer && buffer.content === buffer.saved) state.discardEditorBuffer(key);
    };
  }, [key]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);
    client
      .readTextFile(sessionId, path)
      .then((result) => {
        if (cancelled) return;
        setSnapshot(result);
        // An existing buffer contains unsaved edits; reload only seeds new ones.
        if (!result.binary && !useAppStore.getState().editorBuffers[key]) {
          setEditorBuffer(key, result.content, result.content);
        }
        setStatus("ready");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(formatUnknownError(reason));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, path, key, attempt, setEditorBuffer]);

  const content = buffer?.content ?? "";
  // Paths read relative to the session workspace; the full disk path stays in the tooltip.
  const root = useAppStore((state) => state.sessions.find((session) => session.id === sessionId)?.worktree.path);
  const displayPath = root && path.startsWith(`${root.replace(/\/$/, "")}/`) ? path.slice(root.replace(/\/$/, "").length + 1) : path;
  const dirty = !!buffer && buffer.content !== buffer.saved;

  const persist = async () => {
    if (snapshot?.binary || status !== "ready") return;
    try {
      await useAppStore.getState().saveEditorBuffer(sessionId, path);
      setError(null);
    } catch (reason) {
      setError(formatUnknownError(reason));
    }
  };
  const requestClose = () => {
    if (saving) return;
    if (dirty) setConfirmClose(true);
    else onClose?.();
  };

  const openIn = (editor: EditorId) => {
    void client.openInEditor(sessionId, editor, path).catch((reason: unknown) => {
      useAppStore.setState({ error: formatUnknownError(reason) });
    });
  };

  if (status === "loading") {
    return <p className="px-3 py-6 ui-control text-text-muted">{t("common.loading")}</p>;
  }
  if (status === "error") {
    return (
      <div className="p-3 ui-control text-text-muted">
        <p role="alert" className="mb-2 break-words text-danger">{error}</p>
        <InteractiveButton variant="toolbar" onClick={() => setAttempt((value) => value + 1)}>{t("common.retry")}</InteractiveButton>
      </div>
    );
  }
  if (snapshot?.binary) {
    return <p className="px-3 py-6 ui-control text-text-muted">{t("binary file cannot be previewed as text")}</p>;
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border-subtle px-2">
        <span className="min-w-0 flex-1 truncate font-mono ui-micro text-text-muted" title={path}>{displayPath}</span>
        {saving || dirty ? <span role="status" className="shrink-0 ui-caption text-text-muted">{t(saving ? "Saving…" : "Unsaved changes")}</span> : null}
        {isMarkdown ? <>
          <button type="button" title={t("Code")} aria-label={t("Code")} aria-pressed={view === "code"} onClick={() => setView("code")}
            className={`flex size-6 shrink-0 items-center justify-center rounded-[6px] text-text-muted transition-colors duration-[var(--motion-fast)] hover:bg-background-3 hover:text-text-primary ${view === "code" ? "bg-background-3 text-text-primary" : ""}`}>
            <SquareCode size={13} aria-hidden="true" />
          </button>
          <button type="button" title={t("Preview")} aria-label={t("Preview")} aria-pressed={view === "preview"} onClick={() => setView("preview")}
            className={`flex size-6 shrink-0 items-center justify-center rounded-[6px] text-text-muted transition-colors duration-[var(--motion-fast)] hover:bg-background-3 hover:text-text-primary ${view === "preview" ? "bg-background-3 text-text-primary" : ""}`}>
            <Eye size={13} aria-hidden="true" />
          </button>
        </> : null}
        {installed.length > 0 ? <div className="flex shrink-0 items-center">
          <button type="button" onClick={() => openIn(installed[0].id)}
            className="flex h-6 items-center gap-1.5 rounded-l-[7px] border border-border-subtle px-2 ui-control text-text-secondary hover:bg-background-3 hover:text-text-primary">
            <EditorMark id={installed[0].id} png={editorIcons[installed[0].id]} />
            {t("Open")}
          </button>
          <Dropdown>
            <DropdownTrigger asChild>
              <button type="button" aria-label={t("Open in…")} title={t("Open in…")}
                className="flex h-6 items-center rounded-r-[7px] border border-l-0 border-border-subtle px-1 text-text-muted hover:bg-background-3 hover:text-text-primary">
                <ChevronDown size={12} aria-hidden="true" />
              </button>
            </DropdownTrigger>
            <DropdownContent align="end" side="bottom">
              {installed.map((editor) => (
                <DropdownItem key={editor.id} onSelect={() => openIn(editor.id)}>
                  <span className="flex items-center gap-2">
                    <EditorMark id={editor.id} png={editorIcons[editor.id]} />
                    <span>{editor.name}</span>
                  </span>
                </DropdownItem>
              ))}
            </DropdownContent>
          </Dropdown>
        </div> : null}
        {onClose ? <button type="button" title={t("Close editor")} aria-label={t("Close editor")} onClick={requestClose} disabled={saving}
          className="flex size-5 shrink-0 items-center justify-center rounded-[5px] text-text-muted hover:bg-background-3 hover:text-text-primary">
          <X size={12} aria-hidden="true" />
        </button> : null}
      </div>
      {error ? <p role="alert" className="border-b border-border-subtle px-2 py-1 ui-caption text-danger">{error}</p> : null}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {isMarkdown && view === "preview"
          ? <MarkdownPreview source={content} />
          : <CodeEditor key={key} label={path} value={content} language={languageForPath(path)} onChange={(value) => setEditorBuffer(key, value)} onSave={() => void persist()} reveal={reveal} />}
      </div>
      {onClose && <ConfirmDialog open={confirmClose} onOpenChange={setConfirmClose} title={t("Discard changes?")} description={t("This file has unsaved changes. Closing the tab will discard them.")} cancelLabel={t("Keep editing")} confirmLabel={t("Discard changes")} disabled={saving} onConfirm={() => { if (useAppStore.getState().editorSaving[key]) return false; useAppStore.getState().discardEditorBuffer(key); onClose(); }} />}
    </div>
  );
}
