import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ChevronUp, FileDiff, MessageSquarePlus, Search, X } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import type { FileChange } from "@/client/types";
import { nextDiffRange, type DiffComment } from "@/lib/diff-comment";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { IconButton } from "@/primitives/IconButton";
import { cn } from "@/lib/cn";
import { changeRowLabel } from "@/lib/change-row-label";
import { useAppStore } from "@/store/app-store";
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { cachedDiffLines } from "@/lib/diff-cache";
import { fileDiffFor, nextCodeRow, rowsOfSelection } from "@/lib/diff-pierre";
import { diffViewState, rememberDiffView } from "@/lib/diff-view-state";
import { findDiffMatches, locateRow, searchRows, stepDiffMatch } from "@/lib/diff-find";
import type { SelectedLineRange } from "@pierre/diffs";
import type { DiffCodeHandle,DiffCodeMatch, DiffEntry } from "@/components/diff/DiffCode";
import { effectiveShortcut } from "@/lib/keybindings";
import { shortcutMatches } from "@/lib/shortcuts";
import { usePhoneSetting } from "@/lib/phone-prefs";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import "@/styles/find-bar.css";
import "@/styles/diff.css";

/** Pierre's viewer and its highlighter load the first time a diff is shown (ADR-169). */
const DiffCode = lazy(() => import("@/components/diff/DiffCode"));
/** Chosen rows for a comment, as line indexes within one file's diff. */
type Range = { path: string; diff: string; anchor: number; from: number; to: number };
/** A touch screen, where rows are tapped rather than Shift-clicked. */
const coarsePointer = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
/** The comment draft lives here, so typing in it never re-renders the diff rows. */
function CommentForm({ range, onComment, onClear }: { range: Range; onComment: (selection: DiffComment) => boolean; onClear: () => void }) {
  const t = useTranslation();
  const commentId = useId();
  const [comment, setComment] = useState("");
  const [error, setError] = useState(false);
  return <form className="diff-comment-form shrink-0 space-y-2 border-t border-border-subtle p-3" onSubmit={event => {
    event.preventDefault();
    if (!onComment({ path: range.path, diff: range.diff, from: range.from, to: range.to, comment })) { setError(true); return; }
    onClear();
  }}>
    <div className="flex items-center justify-between"><label htmlFor={commentId} className="ui-caption text-text-primary">{t("review.comment")}</label><IconButton label={t("review.clearSelection")} onClick={onClear}><X size={14} /></IconButton></div>
    <p className="ui-micro text-text-muted">{range.path} · {t("review.selectedLines", { count: range.to - range.from + 1 })}</p>
    <textarea id={commentId} value={comment} maxLength={16384} rows={2} onChange={event => { setComment(event.target.value); setError(false); }} aria-invalid={error || undefined} aria-describedby={error ? `${commentId}-error` : undefined} className="w-full resize-none rounded-[7px] border border-border-subtle bg-background-2 p-2 ui-control text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent" placeholder={t("review.commentPlaceholder")} />
    {error ? <p id={`${commentId}-error`} role="alert" className="ui-caption text-danger">{t("review.commentFailed")}</p> : null}
    <InteractiveButton type="submit" variant="secondary" disabled={!comment.trim()}><MessageSquarePlus size={14} aria-hidden="true" />{t("Add to chat")}</InteractiveButton>
  </form>;
}

/** Rows a guided review points at (ADR-125): highlighted, mounted and scrolled to when `key` changes. */
export interface DiffFocus { key: string; from: number; to: number }

/** One file of a whole-review document (ADR-145). `message` replaces the rows when there is no text diff. */
export interface DiffReviewFile { path: string; diff: string | null; message?: string | null }

/**
 * Diffs, virtualized (ADR-145). With `files`, the whole review is one scroll: every file has a
 * sticky, collapsible header and the list above jumps to it; otherwise `diff` is the selected
 * file's diff. `viewKey` keeps the scroll position, collapsed files and the file in view while
 * the tab is away; `viewOrigin` is what the tab was opened with, so a new request is not
 * overridden by an older place.
 */
export function DiffViewer({ changes, selected, diff, onSelect, emptyDiffMessage, onComment, hideFileList = false, focus = null, files, viewKey, viewOrigin }: {
  changes: FileChange[]; selected: FileChange | null; diff: string | null; onSelect: (change: FileChange) => void; emptyDiffMessage?: string; hideFileList?: boolean;
  onComment?: (selection: DiffComment) => boolean; focus?: DiffFocus | null; files?: readonly DiffReviewFile[]; viewKey?: string; viewOrigin?: string | null;
}) {
  const t = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const multi = !!files?.length;
  const [current, setCurrent] = useState<string | null>(null);
  const jump = useRef<((path: string) => void) | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const shownPath = multi ? current ?? selected?.path ?? null : selected?.path ?? null;
  // The list keeps the file in view visible, scrolling only itself.
  useEffect(() => {
    const box = list.current;
    const row = box?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!box || !row) return;
    if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight;
  }, [shownPath]);
  if (!changes.length) return <EmptyState icon={<FileDiff size={22} />} title={t("No changes")} description={t("Nenhuma alteração detectada neste worktree.")} className="p-4" />;
  return <div ref={root} className="flex h-full min-h-0 flex-col">
    {!hideFileList && <div ref={list} className="scroll-thin relative max-h-[35%] shrink-0 overflow-auto border-b border-border-subtle" aria-label={t("Changes")}>
      {changes.map((change) => <button key={change.path} type="button" aria-pressed={shownPath === change.path} aria-label={changeRowLabel({ path: change.path, kind: t(`change.${change.kind}`), additions: change.additions, deletions: change.deletions })} onClick={() => { if (multi && jump.current) jump.current(change.path); onSelect(change); }} className={cn("flex w-full items-center justify-between gap-2 px-3 py-2 text-left ui-control hover:bg-background-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent", shownPath === change.path ? "bg-background-3 text-text-primary" : "text-text-secondary")}>
        <span className="min-w-0 truncate" title={change.path}>{change.path}<span className="ml-2 ui-micro text-text-muted">{t(`change.${change.kind}`)}</span></span>
        <span className="shrink-0 font-mono ui-micro"><span className="text-success">+{change.additions}</span>{" "}<span className="text-danger">−{change.deletions}</span></span>
      </button>)}
    </div>}
    {multi ? <DiffBody key="review" root={root} files={files} changes={changes} selectedPath={selected?.path ?? null} emptyDiffMessage={emptyDiffMessage} onComment={onComment} focus={null} viewKey={viewKey} viewOrigin={viewOrigin} jump={jump}
      onCurrent={(path) => { setCurrent(path); const change = changes.find((entry) => entry.path === path); if (change && change.path !== selected?.path) onSelect(change); }} />
      : !selected ? <EmptyState title={t("Review changes")} description={t("Select a file to view its diff.")} icon={<FileDiff size={22} />} className="p-4" />
        : diff === null ? <p role="status" className="p-3 ui-control text-text-muted">{t("Loading diff…")}</p> : <>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3 py-2"><span className="min-w-0 truncate font-mono ui-caption" title={selected.path}>{selected.path}</span><CopyButton value={diff} label={t("Copy diff")} /></div>
          {diff.length === 0 ? <p className="p-3 ui-control text-text-muted">{emptyDiffMessage ?? t("No textual diff available.")}</p>
            : <DiffBody key={`file:${selected.path}`} root={root} files={undefined} singlePath={selected.path} singleDiff={diff} changes={changes} selectedPath={selected.path} emptyDiffMessage={emptyDiffMessage} onComment={onComment} focus={focus} viewKey={viewKey} viewOrigin={viewOrigin} jump={jump} />}
        </>}
  </div>;
}

interface BodyProps {
  root: RefObject<HTMLDivElement | null>;
  files: readonly DiffReviewFile[] | undefined;
  /** Without `files`: the one file shown, as primitives so the parsed document stays memoized. */
  singlePath?: string;
  singleDiff?: string;
  changes: FileChange[];
  selectedPath: string | null;
  emptyDiffMessage?: string;
  onComment?: (selection: DiffComment) => boolean;
  focus: DiffFocus | null;
  viewKey?: string;
  viewOrigin?: string | null;
  jump: RefObject<((path: string) => void) | null>;
  onCurrent?: (path: string) => void;
}

/** Pierre's drawn files, the find bar and the comment form of one document (ADR-169). */
function DiffBody({ root, files, singlePath, singleDiff, selectedPath, emptyDiffMessage, onComment, focus, viewKey, viewOrigin, jump, onCurrent }: BodyProps) {
  const t = useTranslation();
  const reduced = useMotionPreferences();
  // Chat behavior: wrap long lines instead of scrolling sideways.
  const wrap = usePhoneSetting("diffWordWrap", useAppStore((state) => state.settings.diffWordWrap));
  // Where this tab was, read once when it mounts.
  const [saved] = useState(() => { const state = diffViewState(viewKey); return state && (state.origin ?? null) === (viewOrigin ?? null) ? state : undefined; });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(saved?.collapsed ?? []));
  const multi = singlePath === undefined;
  const fallbackMessage = emptyDiffMessage ?? t("No textual diff available.");
  const entries = useMemo<DiffEntry[]>(() => !multi
    ? [{ path: singlePath, diff: singleDiff ?? "", lines: cachedDiffLines(singleDiff ?? ""), fileDiff: fileDiffFor(singlePath, singleDiff ?? ""), message: null }]
    : (files ?? []).map((file) => {
      const diff = file.diff ?? "", fileDiff = fileDiffFor(file.path, diff);
      return { path: file.path, diff, lines: cachedDiffLines(diff), fileDiff, message: fileDiff ? null : file.message ?? fallbackMessage };
    }), [multi, singlePath, singleDiff, files, fallbackMessage]);
  const handle = useRef<DiffCodeHandle | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const focusDiff = () => frame.current?.querySelector<HTMLElement>(".diff-pierre")?.focus({ preventScroll: true });

  // The file in view is the selected one (the list follows the scroll).
  const reported = useRef<string | null>(null);
  const onScroll = useCallback((scrollTop: number, path: string | null) => {
    rememberDiffView(viewKey, { scrollTop, origin: viewOrigin ?? null });
    if (!multi || !path || reported.current === path) return;
    reported.current = path;
    rememberDiffView(viewKey, { selected: path, origin: viewOrigin ?? null });
    onCurrent?.(path);
  }, [multi, viewKey, viewOrigin, onCurrent]);
  useLayoutEffect(() => {
    jump.current = multi ? (path) => { reported.current = path; handle.current?.jumpToFile(path); } : null;
    return () => { jump.current = null; };
  }, [jump, multi]);

  const toggleFile = useCallback((path: string) => {
    setCollapsed((value) => {
      const next = new Set(value);
      if (!next.delete(path)) next.add(path);
      rememberDiffView(viewKey, { collapsed: [...next], origin: viewOrigin ?? null });
      return next;
    });
  }, [viewKey, viewOrigin]);

  // Comments on rows of one file at a time.
  const [range, setRange] = useState<Range | null>(null);
  const rangeFile = range ? entries.findIndex((entry) => entry.path === range.path) : -1;
  const activeRange = range && rangeFile >= 0 && entries[rangeFile].diff === range.diff ? range : null;
  const choices = useRef({ entries, activeRange, onComment });
  useLayoutEffect(() => { choices.current = { entries, activeRange, onComment }; });
  const select = useCallback((selection: { path: string; range: SelectedLineRange } | null) => {
    const { entries: files, activeRange: current, onComment: comment } = choices.current;
    if (!comment) return;
    const entry = selection ? files.find((candidate) => candidate.path === selection.path) : undefined;
    const rows = selection && entry ? rowsOfSelection(entry.lines, selection.range) : null;
    if (!selection || !entry || !rows || !entry.diff) { setRange(null); return; }
    // On a touch screen there is no Shift: a second tap extends the line into a range (ADR-124).
    const next = rows.from === rows.to && coarsePointer()
      ? nextDiffRange(current?.path === entry.path ? current : null, rows.from, false, true)
      : { anchor: rows.from, from: rows.from, to: rows.to };
    setRange(next ? { path: entry.path, diff: entry.diff, ...next } : null);
  }, []);
  const clearRange = useCallback(() => setRange(null), []);

  // A guide's anchored rows (single file) are drawn as the selection until a line is chosen.
  const lineCount = entries[0]?.lines.length ?? 0;
  const focusRows = focus && !multi && focus.from >= 0 && focus.from <= focus.to && focus.to < lineCount ? focus : null;
  const focusKey = focusRows ? `${focusRows.key}:${focusRows.from}:${focusRows.to}` : null;
  const selection = activeRange ? { path: activeRange.path, from: activeRange.from, to: activeRange.to }
    : focusRows && entries[0] ? { path: entries[0].path, from: focusRows.from, to: focusRows.to } : null;
  useEffect(() => {
    if (!focusKey || !focusRows || !entries[0]) return;
    handle.current?.revealRow(entries[0].path, focusRows.from, { center: true, smooth: !reduced });
    // Only when the anchor changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  // Find in diff (⌘F with focus or the pointer inside): matches cover every open file, drawn or not.
  const [find, setFind] = useState<{ open: boolean; query: string; revision: number }>({ open: false, query: "", revision: 0 });
  const findInput = useRef<HTMLInputElement>(null);
  const findQuery = useDeferredValue(find.open ? find.query : "");
  const index = useMemo(() => findQuery.trim() ? searchRows(entries.map((entry) => ({ lines: entry.lines, collapsed: multi && collapsed.has(entry.path) }))) : null, [entries, collapsed, multi, findQuery]);
  const found = useMemo(() => index ? findDiffMatches(index.rows, findQuery) : findDiffMatches([], ""), [index, findQuery]);
  const [step, setStep] = useState<{ query: string; entries: readonly DiffEntry[]; index: number } | null>(null);
  const currentIndex = step && step.query === findQuery && step.entries === entries ? Math.min(step.index, found.matches.length - 1) : found.matches.length ? 0 : -1;
  const placed = useMemo<DiffCodeMatch[]>(() => !index ? [] : found.matches.map((match, at) => {
    const where = locateRow(index, match);
    return { path: entries[where.file].path, row: where.line, match, current: at === currentIndex };
  }), [index, found, entries, currentIndex]);
  const current = currentIndex >= 0 ? placed[currentIndex] : undefined;
  const openFind = useCallback(() => setFind(value => ({ open: true, query: value.query, revision: value.revision + 1 })), []);
  const closeFind = () => {
    setFind(value => ({ ...value, open: false }));
    focusDiff();
  };
  const move = (direction: 1 | -1) => {
    if (!found.matches.length) return;
    setStep({ query: findQuery, entries, index: stepDiffMatch(currentIndex, found.matches.length, direction) });
  };
  useLayoutEffect(() => { if (find.open) { findInput.current?.focus(); findInput.current?.select(); } }, [find.open, find.revision]);
  // Bring the current match into view (centred when it was off screen).
  const matchPath = current?.path, matchRow = current?.row, matchStart = current?.match.start;
  useEffect(() => {
    if (matchPath === undefined || matchRow === undefined) return;
    handle.current?.revealRow(matchPath, matchRow, { center: true });
  }, [matchPath, matchRow, matchStart, currentIndex]);

  // ⌘F (the find-in-conversation binding) belongs to the diff while focus is inside it, or
  // while the pointer is over it and no text field has focus; elsewhere the transcript keeps it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const node = root.current;
      if (!node || event.defaultPrevented || event.isComposing) return;
      if (!shortcutMatches(event, effectiveShortcut(useAppStore.getState().settings.customShortcuts, "find-in-conversation"))) return;
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && node.contains(active);
      const hovered = node.matches(":hover") && (!active || active === document.body || !active.closest("input, textarea, select, [contenteditable], .terminal-canvas"));
      if (!inside && !hovered) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openFind();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [root, openFind]);

  // Keyboard: with rows chosen, ↑/↓ move the choice (Shift extends it) and Esc lets it go;
  // Alt+↑/↓ jump between files.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey) return;
    const arrow = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (event.altKey && arrow && multi) {
      const at = entries.findIndex((entry) => entry.path === (handle.current?.position().path ?? entries[0]?.path));
      const target = entries[Math.min(entries.length - 1, Math.max(0, at + arrow))];
      if (!target) return;
      event.preventDefault();
      reported.current = target.path;
      handle.current?.jumpToFile(target.path);
      return;
    }
    if (!activeRange || !onComment) return;
    if (event.key === "Escape") { event.preventDefault(); clearRange(); return; }
    if (!arrow) return;
    const lines = entries[rangeFile].lines;
    const moving = activeRange.anchor === activeRange.from ? activeRange.to : activeRange.from;
    const next = nextCodeRow(lines, event.shiftKey ? moving : arrow > 0 ? activeRange.to : activeRange.from, arrow);
    if (next < 0) return;
    event.preventDefault();
    const anchor = event.shiftKey ? activeRange.anchor : next;
    setRange({ ...activeRange, anchor, from: Math.min(anchor, next), to: Math.max(anchor, next) });
    handle.current?.revealRow(activeRange.path, next);
  };

  const hasRows = entries.some((entry) => entry.fileDiff);
  const labels = useMemo(() => ({
    expand: (path: string) => t("diff.expandFile", { path }), collapse: (path: string) => t("diff.collapseFile", { path }), copy: t("Copy diff"),
    region: singlePath !== undefined ? t("diff.label", { path: singlePath }) : t("Changes"), loading: t("Loading diff…"),
  }), [t, singlePath]);
  const initialTop = saved?.scrollTop ?? null;
  const initialPath = saved ? null : multi ? selectedPath : null;

  return <>
    {onComment && hasRows ? <p className="shrink-0 px-3 py-1 ui-micro text-text-muted">{t(coarsePointer() ? "review.commentHintTouch" : "review.commentHint")}</p> : null}
    <div ref={frame} className="relative flex min-h-0 flex-1 flex-col">
      <AnimatePresence>{find.open && hasRows ? <motion.div key="diff-find" role="search" aria-label={t("diff.find")} className="find-bar" data-diff-find=""
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeFind(); }
          if (event.key === "Enter" && event.target === findInput.current) { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
          if ((event.key === "ArrowDown" || event.key === "ArrowUp") && event.target === findInput.current) { event.preventDefault(); move(event.key === "ArrowDown" ? 1 : -1); }
        }}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.1 } }} transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}>
        <Search size={15} aria-hidden="true" className="shrink-0 text-text-muted" />
        <input ref={findInput} type="search" autoComplete="off" autoCorrect="off" spellCheck={false} aria-label={t("diff.find")} placeholder={t("diff.find")} maxLength={256} value={find.query} onChange={event => { const query = event.target.value; setFind(value => ({ ...value, query })); }} className="find-bar-input ui-control" />
        {findQuery.trim() ? <span role="status" className="shrink-0 tabular-nums ui-caption text-text-muted">{found.matches.length ? `${currentIndex + 1}/${found.matches.length}${found.truncated ? "+" : ""}` : "0/0"}</span> : null}
        <IconButton label={t("diff.findPrevious")} disabled={!found.matches.length} onClick={() => move(-1)}><ChevronUp size={14} /></IconButton>
        <IconButton label={t("diff.findNext")} disabled={!found.matches.length} onClick={() => move(1)}><ChevronDown size={14} /></IconButton>
        <IconButton label={t("diff.findClose")} onClick={closeFind}><X size={14} /></IconButton>
      </motion.div> : null}</AnimatePresence>
      <div className="min-h-0 flex-1">
        {!multi && !hasRows ? <p className="p-3 ui-control text-text-muted">{fallbackMessage}</p>
          : <Suspense fallback={<p role="status" className="p-3 ui-control text-text-muted">{labels.loading}</p>}>
            <DiffCode entries={entries} headers={multi} collapsed={collapsed} wrap={wrap} selectable={!!onComment} selection={selection} matches={placed}
              initialTop={initialTop} initialPath={initialPath} handle={handle} labels={labels} onToggle={toggleFile} onSelect={select} onScroll={onScroll} onKeyDown={onKeyDown} />
          </Suspense>}
      </div>
    </div>
    {activeRange && onComment ? <CommentForm range={activeRange} onComment={onComment} onClear={clearRange} /> : null}
  </>;
}
