import { Fragment, memo, useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ChevronRight, ChevronUp, FileDiff, MessageSquarePlus, Search, X } from "@/components/icons/phosphor";
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
import tokenStyles from "@/components/arc/code-block/code-block.module.css";
import { cachedDiffLines } from "@/lib/diff-cache";
import { buildDiffDocument, fileIndex, FILE_ROW, NOTICE_ROW, rowOfLine, searchableRows, type DiffDocument, type DiffDocumentFile } from "@/lib/diff-document";
import { DIFF_DEFAULT_VIEWPORT, DIFF_FILE_ROW_HEIGHT, DIFF_NOTICE_ROW_HEIGHT, DIFF_ROW_HEIGHT, RowLayout, scrollToReveal, windowRows, wrappedLines } from "@/lib/diff-window";
import { diffHighlighter, splitByTokens } from "@/lib/diff-highlight";
import { diffViewState, rememberDiffView } from "@/lib/diff-view-state";
import { languageForPath } from "@/lib/code-tokens";
import { findDiffMatches, splitByRanges, stepDiffMatch, type DiffMatchRange } from "@/lib/diff-find";
import { effectiveShortcut } from "@/lib/keybindings";
import { shortcutMatches } from "@/lib/shortcuts";
import { usePhoneSetting } from "@/lib/phone-prefs";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import type { DiffLine } from "@/lib/transcript";
import "@/styles/find-bar.css";
import "@/styles/diff.css";

type Translate = ReturnType<typeof useTranslation>;
/** Chosen rows for a comment, as line indexes within one file's diff. */
type Range = { path: string; diff: string; anchor: number; from: number; to: number };
/** A touch screen, where rows are tapped rather than Shift-clicked. */
const coarsePointer = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
/** Space above and below the rows of a single-file diff. */
const SINGLE_PAD = 8;
/** Line-number gutter and row padding, in pixels, added to the widest line for the scroll width. */
const GUTTER = 112;

/**
 * One diff row. Props are primitives or stable references, so typing in the comment box or
 * the find bar re-renders only the rows whose selection or matches changed (ADR-102), and a
 * highlighted segment arriving re-renders only its rows (ADR-145).
 */
const DiffRow = memo(function DiffRow({ line, index, selected, focused, commentable, wrap, code, tokens, ranges, current, onChoose, t }: {
  line: DiffLine; index: number; selected: boolean; focused: boolean; commentable: boolean; wrap: boolean; code: boolean;
  tokens: Uint32Array | undefined; ranges: readonly DiffMatchRange[] | undefined; current: number | null; onChoose: (index: number, extend: boolean) => void; t: Translate;
}) {
  const marked = line.kind === "addition" ? "text-success" : line.kind === "deletion" ? "text-danger" : "";
  const tone = line.kind === "header" ? "text-text-muted" : code ? (line.kind === "context" ? "text-text-secondary" : "text-text-primary") : marked || "text-text-secondary";
  return <div data-diff-index={index} data-guide-focus={focused || undefined} className={cn("flex pr-3", focused && "diff-guide-focus", selected ? "bg-accent/20" : line.kind === "addition" ? "bg-success/10" : line.kind === "deletion" ? "bg-danger/10" : line.kind === "header" ? "bg-background-2" : "", tone)}>
    {commentable && line.kind !== "header" ? <button type="button" data-diff-focus="" aria-label={t("review.selectLine", { old: line.oldLine ?? "—", new: line.newLine ?? "—" })} aria-pressed={selected} onClick={event => onChoose(index, event.shiftKey)} className="mr-2 flex w-[72px] shrink-0 select-none border-r border-border-subtle text-text-muted hover:bg-accent/20 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"><span className="w-9 pr-1 text-right">{line.oldLine ?? ""}</span><span className="w-9 pr-2 text-right">{line.newLine ?? ""}</span></button> : <><span aria-hidden="true" className="w-9 shrink-0 select-none pr-1 text-right text-text-muted">{line.oldLine ?? ""}</span><span aria-hidden="true" className="mr-2 w-9 shrink-0 select-none border-r border-border-subtle pr-2 text-right text-text-muted">{line.newLine ?? ""}</span></>}
    <span className={wrap ? "min-w-0 whitespace-pre-wrap break-all" : "whitespace-pre"}>{ranges ? splitByRanges(line.content, ranges, current).map((part, at) => part.match
      ? <mark key={at} data-diff-match="" data-current={part.current || undefined} className={cn("rounded-sm text-text-primary", part.current ? "bg-accent/60" : "bg-accent/25")}>{part.text}</mark>
      : <Fragment key={at}>{part.text}</Fragment>)
      : tokens && line.kind !== "header" ? <><span className={marked}>{line.content.slice(0, 1)}</span>{splitByTokens(line.content.slice(1), tokens, 0).map((part, at) => part.kind ? <span key={at} className={tokenStyles[part.kind]}>{part.text}</span> : <Fragment key={at}>{part.text}</Fragment>)}</>
        : line.content}</span>
  </div>;
});

/** A file's header in a review: the collapse toggle, its kind and counts, and Copy. */
const FileHeader = memo(function FileHeader({ file, path, change, collapsed, diff, overlay, onToggle, t }: {
  file: number; path: string; change: FileChange | undefined; collapsed: boolean; diff: string | null; overlay: boolean; onToggle: (file: number) => void; t: Translate;
}) {
  return <div className="diff-file-head" data-diff-file={overlay ? undefined : file}>
    <button type="button" data-diff-focus="" tabIndex={overlay ? -1 : undefined} className="diff-file-toggle" aria-expanded={!collapsed} aria-label={t(collapsed ? "diff.expandFile" : "diff.collapseFile", { path })} title={path} onClick={() => onToggle(file)}>
      <ChevronRight size={13} aria-hidden="true" className="diff-file-chevron" />
      <span className="min-w-0 truncate font-mono ui-caption text-text-primary">{path}</span>
      {change ? <span className="shrink-0 ui-micro text-text-muted">{t(`change.${change.kind}`)}</span> : null}
    </button>
    {change && (change.additions || change.deletions) ? <span className="shrink-0 font-mono ui-micro"><span className="text-success">+{change.additions}</span>{" "}<span className="text-danger">−{change.deletions}</span></span> : null}
    {!overlay && diff ? <CopyButton value={diff} label={t("Copy diff")} iconOnly variant="plain" /> : null}
  </div>;
});

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

/** The scrolling rows, the find bar and the comment form of one document. */
function DiffBody({ root, files, singlePath, singleDiff, changes, selectedPath, emptyDiffMessage, onComment, focus, viewKey, viewOrigin, jump, onCurrent }: BodyProps) {
  const t = useTranslation();
  const reduced = useMotionPreferences();
  // Chat behavior: wrap long lines instead of scrolling sideways.
  const wrap = usePhoneSetting("diffWordWrap", useAppStore((state) => state.settings.diffWordWrap));
  // Where this tab was, read once when it mounts.
  const [saved] = useState(() => { const state = diffViewState(viewKey); return state && (state.origin ?? null) === (viewOrigin ?? null) ? state : undefined; });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(saved?.collapsed ?? []));
  const multi = singlePath === undefined;
  const fallbackMessage = emptyDiffMessage ?? t("No textual diff available.");
  const texts = useMemo(() => !multi ? [singleDiff ?? ""] : (files ?? []).map((file) => file.diff ?? ""), [multi, singleDiff, files]);
  const sources = useMemo<DiffDocumentFile[]>(() => !multi
    ? [{ path: singlePath, lines: cachedDiffLines(singleDiff ?? ""), message: null }]
    : (files ?? []).map((file) => ({ path: file.path, lines: cachedDiffLines(file.diff ?? ""), message: file.diff ? null : file.message ?? fallbackMessage })), [multi, singlePath, singleDiff, files, fallbackMessage]);
  const doc = useMemo(() => buildDiffDocument(sources, collapsed, multi), [sources, collapsed, multi]);
  const languages = useMemo(() => sources.map((file) => languageForPath(file.path)), [sources]);
  const changeOf = useMemo(() => new Map(changes.map((change) => [change.path, change])), [changes]);
  const pad = multi ? 0 : SINGLE_PAD;

  // Geometry: the line height and character width come from the rendered rows (the phone uses
  // taller rows), the width from the scroller; wrapped rows are measured once mounted.
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const sticky = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [metrics, setMetrics] = useState({ line: DIFF_ROW_HEIGHT, char: 7.2, width: 0 });
  const columns = Math.max(20, Math.floor((metrics.width - GUTTER) / metrics.char));
  const layout = useMemo(() => new RowLayout(doc.length, (row) => {
    const line = doc.rowLine[row];
    if (line === FILE_ROW) return DIFF_FILE_ROW_HEIGHT;
    if (line === NOTICE_ROW) return DIFF_NOTICE_ROW_HEIGHT;
    return wrap && metrics.width ? metrics.line * wrappedLines(doc.files[doc.rowFile[row]].lines[line].content.length, columns) : metrics.line;
  }), [doc, wrap, metrics.line, metrics.width, columns]);
  const [, setMeasured] = useState(0);

  // The viewport drives the window of mounted rows; a scroll re-renders only when the window
  // or the file in view changes (diff-window.ts).
  const [viewport, setViewport] = useState({ top: saved?.scrollTop ?? 0, height: DIFF_DEFAULT_VIEWPORT, synced: false });
  const span = useMemo(() => windowRows(layout, viewport.top - pad, viewport.top - pad + viewport.height), [layout, viewport, pad]);
  const fileAtTop = doc.length ? doc.rowFile[layout.rowAt(viewport.top - pad)] : -1;
  const latest = useRef({ doc, layout, span, fileAtTop, pad });
  useLayoutEffect(() => { latest.current = { doc, layout, span, fileAtTop, pad }; });

  const placeSticky = useCallback((top: number) => {
    const node = sticky.current;
    const { doc: rows, layout: places } = latest.current;
    if (!node || !rows.headers || !rows.length) return;
    const file = rows.rowFile[places.rowAt(top)];
    const headerTop = places.offsetOf(rows.fileRow[file]);
    const nextTop = file + 1 < rows.files.length ? places.offsetOf(rows.fileRow[file + 1]) : Number.POSITIVE_INFINITY;
    node.style.visibility = top > headerTop + 0.5 ? "" : "hidden";
    node.style.transform = `translateY(${Math.min(0, nextTop - top - DIFF_FILE_ROW_HEIGHT)}px)`;
  }, []);
  const sync = useCallback(() => {
    const box = scroller.current;
    if (!box) return;
    const top = box.scrollTop, height = box.clientHeight || DIFF_DEFAULT_VIEWPORT;
    const { doc: rows, layout: places, span: shown, fileAtTop: shownFile, pad: offset } = latest.current;
    const next = windowRows(places, top - offset, top - offset + height);
    const file = rows.length ? rows.rowFile[places.rowAt(top - offset)] : -1;
    placeSticky(top);
    rememberDiffView(viewKey, { scrollTop: top, scrollLeft: box.scrollLeft, origin: viewOrigin ?? null });
    setViewport((value) => next.start !== shown.start || next.end !== shown.end || file !== shownFile || Math.abs(value.height - height) > 1 || !value.synced ? { top, height, synced: true } : value);
  }, [placeSticky, viewKey, viewOrigin]);
  const frame = useRef(0);
  const onScroll = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = 0; sync(); });
  }, [sync]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const scrollBox = useCallback((top: number, smooth = false) => {
    const box = scroller.current;
    if (!box) return;
    if (smooth && box.scrollTo) box.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    else box.scrollTop = Math.max(0, top);
    sync();
  }, [sync]);

  // The scroller's size: a height change moves the window, a width change re-estimates wrapped rows.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const read = () => setMetrics((value) => value.width === box.clientWidth ? value : { ...value, width: box.clientWidth });
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => { read(); sync(); });
    observer.observe(box);
    return () => observer.disconnect();
  }, [sync]);

  // After each render: sample the row height and character width, measure wrapped rows, and
  // keep the first visible row in place when rows above it changed height.
  useLayoutEffect(() => {
    const box = scroller.current, body = content.current;
    if (!box || !body) return;
    // The probe is one unwrapped line of ten characters in the rows' font.
    const size = probe.current?.getBoundingClientRect();
    const lineHeight = size?.height ?? 0, charWidth = size ? size.width / 10 : 0;
    if ((lineHeight > 0 && Math.abs(lineHeight - metrics.line) > 0.5) || (charWidth > 0 && Math.abs(charWidth - metrics.char) > 0.05)) {
      setMetrics((value) => ({ ...value, line: lineHeight > 0 ? lineHeight : value.line, char: charWidth > 0 ? charWidth : value.char }));
      return;
    }
    if (!wrap) return;
    const anchor = layout.rowAt(box.scrollTop - pad), before = layout.offsetOf(anchor);
    let changed = false;
    for (const node of body.querySelectorAll<HTMLElement>("[data-diff-index]")) changed = layout.measure(Number(node.dataset.diffIndex), node.offsetHeight) || changed;
    if (!changed) return;
    const moved = layout.offsetOf(anchor) - before;
    if (moved && box.scrollTop > 0) box.scrollTop += moved;
    setMeasured((value) => value + 1);
  }, [metrics.line, metrics.char, wrap, layout, pad, span.start, span.end]);

  // Coming back: the place this tab was left at, or the file it was opened on.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    if (saved) { box.scrollTop = saved.scrollTop; box.scrollLeft = saved.scrollLeft; }
    else if (multi && selectedPath) {
      const file = fileIndex(doc, selectedPath);
      if (file > 0) box.scrollTop = layout.offsetOf(doc.fileRow[file]);
    }
    sync();
    // Only when the document first mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The file in view is the selected one (the list follows the scroll).
  const reported = useRef<string | null>(null);
  const topPath = fileAtTop >= 0 ? doc.files[fileAtTop]?.path ?? null : null;
  useEffect(() => {
    if (!multi || !viewport.synced || !topPath || reported.current === topPath) return;
    reported.current = topPath;
    rememberDiffView(viewKey, { selected: topPath, origin: viewOrigin ?? null });
    onCurrent?.(topPath);
  }, [multi, viewport.synced, topPath, viewKey, viewOrigin, onCurrent]);
  const scrollToFile = useCallback((path: string) => {
    const { doc: rows, layout: places } = latest.current;
    const file = fileIndex(rows, path);
    if (file < 0) return;
    reported.current = path;
    scrollBox(places.offsetOf(rows.fileRow[file]));
  }, [scrollBox]);
  useLayoutEffect(() => { jump.current = multi ? scrollToFile : null; return () => { jump.current = null; }; }, [jump, multi, scrollToFile]);

  // Collapsing the file whose header is pinned keeps that header at the top.
  const pinTo = useRef<number | null>(null);
  const toggleFile = useCallback((file: number) => {
    const { doc: rows, layout: places } = latest.current;
    const path = rows.files[file]?.path;
    const box = scroller.current;
    if (!path) return;
    if (box && box.scrollTop > places.offsetOf(rows.fileRow[file])) pinTo.current = file;
    setCollapsed((value) => {
      const next = new Set(value);
      if (!next.delete(path)) next.add(path);
      rememberDiffView(viewKey, { collapsed: [...next], origin: viewOrigin ?? null });
      return next;
    });
  }, [viewKey, viewOrigin]);
  useLayoutEffect(() => {
    if (pinTo.current === null) return;
    const file = pinTo.current;
    pinTo.current = null;
    scrollBox(layout.offsetOf(doc.fileRow[file]));
  }, [doc, layout, scrollBox]);

  // Comments on rows of one file at a time.
  const [range, setRange] = useState<Range | null>(null);
  const rangeFile = range ? fileIndex(doc, range.path) : -1;
  const activeRange = range && rangeFile >= 0 && texts[rangeFile] === range.diff ? range : null;
  const commentable = (file: number) => !!onComment && !!texts[file] && doc.files[file].lines.length > 0;
  const choices = useRef({ doc, texts, activeRange, onComment });
  useLayoutEffect(() => { choices.current = { doc, texts, activeRange, onComment }; });
  const locate = (rows: DiffDocument, row: number) => rows.rowLine[row] >= 0 ? { file: rows.rowFile[row], line: rows.rowLine[row] } : null;
  const choose = useCallback((fromRow: number, toRow: number) => {
    const { doc: rows, texts: diffs, onComment: comment } = choices.current;
    const start = locate(rows, fromRow), end = locate(rows, toRow);
    if (!comment || !start || !end || start.file !== end.file || !diffs[start.file]) return;
    setRange({ path: rows.files[start.file].path, diff: diffs[start.file], anchor: start.line, from: Math.min(start.line, end.line), to: Math.max(start.line, end.line) });
  }, []);
  // On a touch screen there is no Shift: a second tap extends the line into a range (ADR-124).
  const chooseRow = useCallback((row: number, extend: boolean) => {
    const { doc: rows, texts: diffs, activeRange: current, onComment: comment } = choices.current;
    const at = locate(rows, row);
    if (!comment || !at || !diffs[at.file]) return;
    const path = rows.files[at.file].path;
    const next = nextDiffRange(current?.path === path ? current : null, at.line, extend, coarsePointer());
    setRange(next ? { path, diff: diffs[at.file], ...next } : null);
  }, []);
  const clearRange = useCallback(() => setRange(null), []);

  // Find in diff (⌘F with focus or the pointer inside): matches cover every row, mounted or not.
  const [find, setFind] = useState<{ open: boolean; query: string; revision: number }>({ open: false, query: "", revision: 0 });
  const findInput = useRef<HTMLInputElement>(null);
  const findQuery = useDeferredValue(find.open ? find.query : "");
  const targets = useMemo(() => findQuery.trim() ? searchableRows(doc) : [], [doc, findQuery]);
  const found = useMemo(() => findDiffMatches(targets, findQuery), [targets, findQuery]);
  const [step, setStep] = useState<{ query: string; doc: DiffDocument; index: number } | null>(null);
  const currentIndex = step && step.query === findQuery && step.doc === doc ? Math.min(step.index, found.matches.length - 1) : found.matches.length ? 0 : -1;
  const currentMatch = currentIndex >= 0 ? found.matches[currentIndex] : undefined;
  const openFind = useCallback(() => setFind(value => ({ open: true, query: value.query, revision: value.revision + 1 })), []);
  const closeFind = () => {
    setFind(value => ({ ...value, open: false }));
    scroller.current?.focus({ preventScroll: true });
  };
  const move = (direction: 1 | -1) => {
    if (!found.matches.length) return;
    setStep({ query: findQuery, doc, index: stepDiffMatch(currentIndex, found.matches.length, direction) });
  };
  useLayoutEffect(() => { if (find.open) { findInput.current?.focus(); findInput.current?.select(); } }, [find.open, find.revision]);
  // Bring the current match into view (centred when it was off screen).
  const matchRow = currentMatch?.line ?? -1;
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box || matchRow < 0) return;
    const { layout: places, pad: offset } = latest.current;
    const height = box.clientHeight || DIFF_DEFAULT_VIEWPORT;
    const kept = scrollToReveal(places, matchRow, matchRow, box.scrollTop - offset, height, { margin: multi ? DIFF_FILE_ROW_HEIGHT : 0 });
    if (kept !== box.scrollTop - offset) scrollBox(scrollToReveal(places, matchRow, matchRow, box.scrollTop - offset, height, { center: true }) + offset);
  }, [matchRow, currentMatch, multi, scrollBox]);

  // A guide's anchored rows (single file) scroll into the upper part of the diff.
  const focusRows = focus && !multi && focus.from >= 0 && focus.from <= focus.to && focus.to < (doc.files[0]?.lines.length ?? 0) ? focus : null;
  const focusKey = focusRows ? `${focusRows.key}:${focusRows.from}:${focusRows.to}` : null;
  const focusFrom = focusRows ? rowOfLine(doc, 0, focusRows.from) : -1;
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box || !focusKey || focusFrom < 0) return;
    scrollBox(pad + layout.offsetOf(focusFrom) - Math.min(box.clientHeight / 4, 96), !reduced);
    // Only when the anchor changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, focusFrom]);

  // ⌘F (the find-in-conversation binding) belongs to the diff while focus is inside it, or
  // while the pointer is over it and no text field has focus; elsewhere the transcript keeps it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const node = root.current;
      if (!node || event.defaultPrevented || event.isComposing) return;
      if (!shortcutMatches(event, effectiveShortcut(useAppStore.getState().settings.customShortcuts, "find-in-conversation"))) return;
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && node.contains(active);
      const hovered = node.matches(":hover") && (!active || active === document.body || !active.closest("input, textarea, select, [contenteditable], .xterm"));
      if (!inside && !hovered) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openFind();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [root, openFind]);

  // Colours: ask the worker for the rows in the window, the file at the top first.
  const highlighter = diffHighlighter();
  const [, setPainted] = useState(0);
  useEffect(() => highlighter.subscribe(() => setPainted((value) => value + 1)), [highlighter]);
  useEffect(() => {
    if (!highlighter.available || span.end <= span.start) return;
    const ranges: { lines: readonly DiffLine[]; language: string; from: number; to: number }[] = [];
    for (let row = span.start; row < span.end;) {
      const file = doc.rowFile[row];
      let end = row;
      while (end < span.end && doc.rowFile[end] === file) end++;
      const lines = doc.files[file].lines, language = languages[file];
      let from = -1, to = -1;
      for (let at = row; at < end; at++) { const line = doc.rowLine[at]; if (line >= 0) { if (from < 0) from = line; to = line + 1; } }
      if (language && from >= 0) ranges.push({ lines, language, from, to });
      row = end;
    }
    const top = ranges.findIndex((entry) => entry.lines === doc.files[fileAtTop]?.lines);
    if (top > 0) ranges.unshift(...ranges.splice(top, 1));
    highlighter.want(ranges);
  }, [highlighter, doc, languages, span.start, span.end, fileAtTop]);

  // Keyboard: ↑/↓ move between the focusable rows (line buttons, file headers), Shift extends
  // the comment range, Alt+↑/↓ jump between files. The target row is mounted, then focused.
  const focusRow = useRef<number | null>(null);
  useLayoutEffect(() => {
    const row = focusRow.current;
    if (row === null) return;
    const selector = doc.rowLine[row] === FILE_ROW ? `[data-diff-file="${doc.rowFile[row]}"] [data-diff-focus]` : `[data-diff-index="${row}"] [data-diff-focus]`;
    const target = content.current?.querySelector<HTMLElement>(selector);
    if (target) { focusRow.current = null; target.focus({ preventScroll: true }); }
  });
  const reveal = (row: number) => {
    const box = scroller.current;
    if (!box) return;
    const height = box.clientHeight || DIFF_DEFAULT_VIEWPORT;
    const top = scrollToReveal(layout, row, row, box.scrollTop - pad, height, { margin: multi && doc.rowLine[row] !== FILE_ROW ? DIFF_FILE_ROW_HEIGHT : 0 });
    if (top !== box.scrollTop - pad) scrollBox(top + pad);
  };
  const focusable = (row: number) => {
    const line = doc.rowLine[row];
    if (line === FILE_ROW) return true;
    return line >= 0 && commentable(doc.rowFile[row]) && doc.files[doc.rowFile[row]].lines[line].kind !== "header";
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey) return;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const element = event.target as HTMLElement;
    const holder = element.closest<HTMLElement>("[data-diff-index], [data-diff-file]");
    const from = holder?.dataset.diffIndex !== undefined ? Number(holder.dataset.diffIndex) : holder?.dataset.diffFile !== undefined ? doc.fileRow[Number(holder.dataset.diffFile)] : -1;
    if (event.altKey && doc.headers) {
      const file = from >= 0 ? doc.rowFile[from] : fileAtTop;
      const target = Math.min(doc.files.length - 1, Math.max(0, file + direction));
      event.preventDefault();
      scrollBox(layout.offsetOf(doc.fileRow[target]));
      if (from >= 0) focusRow.current = doc.fileRow[target];
      return;
    }
    if (from < 0 || element.tagName !== "BUTTON") return;
    let next = from + direction;
    while (next >= 0 && next < doc.length && !focusable(next)) next += direction;
    if (next < 0 || next >= doc.length) return;
    event.preventDefault();
    if (event.shiftKey && doc.rowLine[next] >= 0 && doc.rowLine[from] >= 0 && doc.rowFile[next] === doc.rowFile[from]) chooseRow(next, true);
    focusRow.current = next;
    reveal(next);
  };

  const hasRows = doc.length > 0;
  const width = metrics.width ? `${metrics.width}px` : "100%";
  const rows: ReactNode[] = [];
  for (let row = span.start; row < span.end; row++) {
    const file = doc.rowFile[row], line = doc.rowLine[row], entry = doc.files[file];
    if (line === FILE_ROW) {
      rows.push(<div key={`head:${file}`} style={{ width }} className="diff-file-row"><FileHeader file={file} path={entry.path} change={changeOf.get(entry.path)} collapsed={collapsed.has(entry.path)} diff={texts[file] || null} overlay={false} onToggle={toggleFile} t={t} /></div>);
    } else if (line === NOTICE_ROW) {
      rows.push(<p key={`notice:${file}`} data-diff-index={row} style={{ width }} className="diff-notice ui-control text-text-muted">{entry.message}</p>);
    } else {
      const value = entry.lines[line];
      const language = languages[file];
      rows.push(<DiffRow key={`${file}:${line}`} line={value} index={row} t={t} wrap={wrap} commentable={commentable(file)} onChoose={chooseRow} code={!!language}
        tokens={language ? highlighter.tokensFor(entry.lines, line) : undefined}
        selected={!!activeRange && rangeFile === file && line >= activeRange.from && line <= activeRange.to}
        focused={!!focusRows && line >= focusRows.from && line <= focusRows.to}
        ranges={found.byLine.get(row)} current={currentMatch?.line === row ? currentMatch.start : null} />);
    }
  }
  const stickyFile = doc.headers && fileAtTop >= 0 ? fileAtTop : -1;
  const stickyEntry = stickyFile >= 0 ? doc.files[stickyFile] : null;
  useLayoutEffect(() => { if (scroller.current) placeSticky(scroller.current.scrollTop); });

  return <>
    {onComment && hasRows ? <p className="shrink-0 px-3 py-1 ui-micro text-text-muted">{t(coarsePointer() ? "review.commentHintTouch" : "review.commentHint")}</p> : null}
    <div className="relative flex min-h-0 flex-1 flex-col">
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
      <div ref={scroller} className="diff-scroller selectable scroll-thin min-h-0 flex-1 overflow-auto" tabIndex={0} role="region" aria-label={singlePath !== undefined ? t("diff.label", { path: singlePath }) : t("Changes")} onScroll={onScroll} onKeyDown={onKeyDown}
        onPointerUp={event => {
          if (!onComment || (event.target as Element).closest("button")) return;
          const selection = window.getSelection();
          if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
          const picked = selection.getRangeAt(0);
          const row = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-diff-index]");
          const start = row(picked.startContainer), end = row(picked.endContainer);
          if (start && end && event.currentTarget.contains(start) && event.currentTarget.contains(end)) choose(Number(start.dataset.diffIndex), Number(end.dataset.diffIndex));
        }}>
        <div ref={content} className="diff-code relative leading-5" style={{ height: layout.total + 2 * pad, minWidth: wrap ? undefined : `calc(${doc.columns + 2}ch + ${GUTTER}px)` } as CSSProperties}>
          <span ref={probe} aria-hidden="true" className="diff-probe">0000000000</span>
          {stickyEntry ? <div ref={sticky} aria-hidden="true" className="diff-file-sticky" style={{ width, visibility: "hidden" }}>
            <FileHeader file={stickyFile} path={stickyEntry.path} change={changeOf.get(stickyEntry.path)} collapsed={collapsed.has(stickyEntry.path)} diff={null} overlay onToggle={toggleFile} t={t} />
          </div> : null}
          <div style={{ transform: `translateY(${pad + layout.offsetOf(span.start)}px)` }}>{rows}</div>
        </div>
      </div>
    </div>
    {activeRange && onComment ? <CommentForm range={activeRange} onComment={onComment} onClear={clearRange} /> : null}
  </>;
}
