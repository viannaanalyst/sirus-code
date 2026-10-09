import { Fragment, memo, startTransition, useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ChevronUp, FileDiff, MessageSquarePlus, Search, X } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import type { FileChange } from "@/client/types";
import { reviewDiffLines, type DiffComment } from "@/lib/diff-comment";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { IconButton } from "@/primitives/IconButton";
import { cn } from "@/lib/cn";
import { changeRowLabel } from "@/lib/change-row-label";
import { useAppStore } from "@/store/app-store";
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { CodeBlock } from "@/components/arc/code-block/code-block";
import { DIFF_HIGHLIGHT_LIMIT, DIFF_ROOT_MARGIN, diffCountFor, initialDiffCount, nextDiffCount, reservedDiffHeight } from "@/lib/diff-window";
import { findDiffMatches, splitByRanges, stepDiffMatch, type DiffMatchRange } from "@/lib/diff-find";
import { effectiveShortcut } from "@/lib/keybindings";
import { shortcutMatches } from "@/lib/shortcuts";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import "@/styles/find-bar.css";

type DiffLine = ReturnType<typeof reviewDiffLines>[number];
type Translate = ReturnType<typeof useTranslation>;
type Range = { path: string; diff: string; anchor: number; from: number; to: number };

/**
 * One diff row. Props are primitives or stable references, so typing in the comment box or
 * the find bar re-renders only the rows whose selection or matches changed (ADR-102).
 */
const DiffRow = memo(function DiffRow({ line, index, selected, commentable, wrap, ranges, current, onChoose, t }: {
  line: DiffLine; index: number; selected: boolean; commentable: boolean; wrap: boolean;
  ranges: readonly DiffMatchRange[] | undefined; current: number | null; onChoose: (index: number, extend: boolean) => void; t: Translate;
}) {
  return <div data-diff-index={index} className={cn("flex pr-3", selected ? "bg-accent/20" : line.kind === "addition" ? "bg-success/10" : line.kind === "deletion" ? "bg-danger/10" : line.kind === "header" ? "bg-background-2" : "", line.kind === "addition" ? "text-success" : line.kind === "deletion" ? "text-danger" : line.kind === "header" ? "text-text-muted" : "text-text-secondary")}>
    {commentable && line.kind !== "header" ? <button type="button" aria-label={t("review.selectLine", { old: line.oldLine ?? "—", new: line.newLine ?? "—" })} aria-pressed={selected} onClick={event => onChoose(index, event.shiftKey)} className="mr-2 flex w-[72px] shrink-0 select-none border-r border-border-subtle text-text-muted hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-accent"><span className="w-9 pr-1 text-right">{line.oldLine ?? ""}</span><span className="w-9 pr-2 text-right">{line.newLine ?? ""}</span></button> : <><span aria-hidden="true" className="w-9 shrink-0 select-none pr-1 text-right text-text-muted">{line.oldLine ?? ""}</span><span aria-hidden="true" className="mr-2 w-9 shrink-0 select-none border-r border-border-subtle pr-2 text-right text-text-muted">{line.newLine ?? ""}</span></>}
    <span className={wrap ? "min-w-0 whitespace-pre-wrap break-all" : "whitespace-pre"}>{ranges ? splitByRanges(line.content, ranges, current).map((part, at) => part.match
      ? <mark key={at} data-diff-match="" data-current={part.current || undefined} className={cn("rounded-sm text-text-primary", part.current ? "bg-accent/60" : "bg-accent/25")}>{part.text}</mark>
      : <Fragment key={at}>{part.text}</Fragment>) : line.content}</span>
  </div>;
});

/** The comment draft lives here, so typing in it never re-renders the diff rows. */
function CommentForm({ range, onComment, onClear }: { range: Range; onComment: (selection: DiffComment) => boolean; onClear: () => void }) {
  const t = useTranslation();
  const commentId = useId();
  const [comment, setComment] = useState("");
  const [error, setError] = useState(false);
  return <form className="shrink-0 space-y-2 border-t border-border-subtle p-3" onSubmit={event => {
    event.preventDefault();
    if (!onComment({ path: range.path, diff: range.diff, from: range.from, to: range.to, comment })) { setError(true); return; }
    onClear();
  }}>
    <div className="flex items-center justify-between"><label htmlFor={commentId} className="ui-caption text-text-primary">{t("review.comment")}</label><IconButton label={t("review.clearSelection")} onClick={onClear}><X size={14} /></IconButton></div>
    <p className="ui-micro text-text-muted">{t("review.selectedLines", { count: range.to - range.from + 1 })}</p>
    <textarea id={commentId} value={comment} maxLength={16384} rows={2} onChange={event => { setComment(event.target.value); setError(false); }} aria-invalid={error || undefined} aria-describedby={error ? `${commentId}-error` : undefined} className="w-full resize-none rounded-[7px] border border-border-subtle bg-background-2 p-2 ui-control text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent" placeholder={t("review.commentPlaceholder")} />
    {error ? <p id={`${commentId}-error`} role="alert" className="ui-caption text-danger">{t("review.commentFailed")}</p> : null}
    <InteractiveButton type="submit" variant="secondary" disabled={!comment.trim()}><MessageSquarePlus size={14} aria-hidden="true" />{t("Add to chat")}</InteractiveButton>
  </form>;
}

export function DiffViewer({ changes, selected, diff, onSelect, emptyDiffMessage, onComment, hideFileList = false }: { changes: FileChange[]; selected: FileChange | null; diff: string | null; onSelect: (change: FileChange) => void; emptyDiffMessage?: string; hideFileList?: boolean; onComment?: (selection: DiffComment) => boolean }) {
  // Chat behavior: wrap long lines instead of scrolling sideways.
  const wrap = useAppStore((state) => state.settings.diffWordWrap);
  const t = useTranslation();
  const reduced = useMotionPreferences();
  const lines = useMemo(() => reviewDiffLines(diff ?? ""), [diff]);
  const [range, setRange] = useState<Range | null>(null);
  const activeRange = range?.path === selected?.path && range?.diff === diff ? range : null;
  // Find in diff (⌘F with focus or the pointer inside): matches cover every line, and the
  // current match mounts the chunks up to it.
  const [find, setFind] = useState<{ open: boolean; query: string; revision: number }>({ open: false, query: "", revision: 0 });
  const findQuery = useDeferredValue(find.open ? find.query : "");
  const found = useMemo(() => findDiffMatches(lines, findQuery), [lines, findQuery]);
  const [step, setStep] = useState<{ query: string; lines: DiffLine[]; index: number } | null>(null);
  const currentIndex = step && step.query === findQuery && step.lines === lines ? Math.min(step.index, found.matches.length - 1) : found.matches.length ? 0 : -1;
  const currentMatch = currentIndex >= 0 ? found.matches[currentIndex] : undefined;
  // Large diffs mount in chunks (MonoCode-style): a sentinel below the last mounted row
  // mounts the next chunk once it nears the viewport. A new diff starts from one chunk.
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState<{ diff: string | null; count: number }>({ diff: null, count: 0 });
  const grown = shown.diff === diff ? shown.count : 0;
  // A selected range and the current match are always mounted, so they stay highlighted.
  const mounted = Math.max(grown, initialDiffCount(lines.length), activeRange ? diffCountFor(activeRange.to, lines.length) : 0, currentMatch ? diffCountFor(currentMatch.line, lines.length) : 0);
  const untracked = diff?.startsWith("+++ untracked\n") ?? false;
  const highlighted = untracked && !onComment && lines.length <= DIFF_HIGHLIGHT_LIMIT && !findQuery.trim();
  const more = !highlighted && mounted < lines.length;
  useEffect(() => {
    const scrollRoot = scroller.current, target = sentinel.current;
    if (!more || !scrollRoot || !target || typeof IntersectionObserver === "undefined") return;
    // One observer per list; it is recreated per chunk, so a sentinel that is still near
    // after a chunk mounts reports again and the next chunk follows.
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      startTransition(() => setShown({ diff, count: nextDiffCount(mounted, lines.length) }));
    }, { root: scrollRoot, rootMargin: DIFF_ROOT_MARGIN });
    observer.observe(target);
    return () => observer.disconnect();
  }, [more, diff, mounted, lines.length]);
  // Rows get a stable callback; it reads the latest selection through a ref.
  const latest = useRef({ selected, diff, onComment, activeRange });
  useLayoutEffect(() => { latest.current = { selected, diff, onComment, activeRange }; });
  const choose = useCallback((from: number, to = from, extend = false) => {
    const { selected: file, diff: text, onComment: comment, activeRange: current } = latest.current;
    if (!file || text === null || !comment) return;
    const anchor = extend && current ? current.anchor : from;
    setRange({ path: file.path, diff: text, anchor, from: Math.min(anchor, to), to: Math.max(anchor, to) });
  }, []);
  const chooseRow = useCallback((index: number, extend: boolean) => choose(index, index, extend), [choose]);
  const clearRange = useCallback(() => setRange(null), []);

  const openFind = useCallback(() => setFind(current => ({ open: true, query: current.query, revision: current.revision + 1 })), []);
  const closeFind = () => {
    setFind(current => ({ ...current, open: false }));
    scroller.current?.focus({ preventScroll: true });
  };
  const move = (direction: 1 | -1) => {
    if (!found.matches.length) return;
    setStep({ query: findQuery, lines, index: stepDiffMatch(currentIndex, found.matches.length, direction) });
  };
  useLayoutEffect(() => { if (find.open) { findInput.current?.focus(); findInput.current?.select(); } }, [find.open, find.revision]);
  // Bring the current match into view once its chunk is mounted.
  useLayoutEffect(() => {
    if (!currentMatch) return;
    scroller.current?.querySelector<HTMLElement>("mark[data-current]")?.scrollIntoView?.({ block: "center", inline: "nearest" });
  }, [currentMatch]);
  // ⌘F (the find-in-conversation binding) belongs to the diff while focus is inside it, or
  // while the pointer is over it and no text field has focus; elsewhere the transcript keeps it.
  const hasDiff = !!selected && diff !== null && diff.length > 0;
  useEffect(() => {
    if (!hasDiff) return;
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
  }, [hasDiff, openFind]);

  if (!changes.length) return <EmptyState icon={<FileDiff size={22} />} title={t("No changes")} description={t("Nenhuma alteração detectada neste worktree.")} className="p-4" />;
  return <div ref={root} className="flex h-full min-h-0 flex-col">
    {!hideFileList && <div className="scroll-thin max-h-[35%] shrink-0 overflow-auto border-b border-border-subtle" aria-label={t("Changes")}>
      {changes.map((change) => <button key={change.path} type="button" aria-pressed={selected?.path === change.path} aria-label={changeRowLabel({ path: change.path, kind: t(`change.${change.kind}`), additions: change.additions, deletions: change.deletions })} onClick={() => onSelect(change)} className={cn("flex w-full items-center justify-between gap-2 px-3 py-2 text-left ui-control hover:bg-background-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent", selected?.path === change.path ? "bg-background-3 text-text-primary" : "text-text-secondary")}>
        <span className="min-w-0 truncate" title={change.path}>{change.path}<span className="ml-2 ui-micro text-text-muted">{t(`change.${change.kind}`)}</span></span>
        <span className="shrink-0 font-mono ui-micro"><span className="text-success">+{change.additions}</span>{" "}<span className="text-danger">−{change.deletions}</span></span>
      </button>)}
    </div>}
    {!selected ? <EmptyState title={t("Review changes")} description={t("Select a file to view its diff.")} icon={<FileDiff size={22} />} className="p-4" /> : diff === null ? <p role="status" className="p-3 ui-control text-text-muted">{t("Loading diff…")}</p> : <>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3 py-2"><span className="min-w-0 truncate font-mono ui-caption" title={selected.path}>{selected.path}</span><CopyButton value={diff} label={t("Copy diff")} /></div>
      {onComment && diff.length ? <p className="shrink-0 px-3 py-1 ui-micro text-text-muted">{t("review.commentHint")}</p> : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <AnimatePresence>{find.open && hasDiff ? <motion.div key="diff-find" role="search" aria-label={t("diff.find")} className="find-bar" data-diff-find=""
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeFind(); }
            if (event.key === "Enter" && event.target === findInput.current) { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && event.target === findInput.current) { event.preventDefault(); move(event.key === "ArrowDown" ? 1 : -1); }
          }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.1 } }} transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}>
          <Search size={15} aria-hidden="true" className="shrink-0 text-text-muted" />
          <input ref={findInput} type="search" autoComplete="off" autoCorrect="off" spellCheck={false} aria-label={t("diff.find")} placeholder={t("diff.find")} maxLength={256} value={find.query} onChange={event => { const query = event.target.value; setFind(current => ({ ...current, query })); }} className="find-bar-input ui-control" />
          {findQuery.trim() ? <span role="status" className="shrink-0 tabular-nums ui-caption text-text-muted">{found.matches.length ? `${currentIndex + 1}/${found.matches.length}${found.truncated ? "+" : ""}` : "0/0"}</span> : null}
          <IconButton label={t("diff.findPrevious")} disabled={!found.matches.length} onClick={() => move(-1)}><ChevronUp size={14} /></IconButton>
          <IconButton label={t("diff.findNext")} disabled={!found.matches.length} onClick={() => move(1)}><ChevronDown size={14} /></IconButton>
          <IconButton label={t("diff.findClose")} onClick={closeFind}><X size={14} /></IconButton>
        </motion.div> : null}</AnimatePresence>
        <div ref={scroller} className="selectable scroll-thin min-h-0 flex-1 overflow-auto" tabIndex={0} role="region" aria-label={t("diff.label", { path: selected.path })}
          onPointerUp={event => {
            if (!onComment || (event.target as Element).closest("button")) return;
            const selection = window.getSelection();
            if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
            const picked = selection.getRangeAt(0);
            const row = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-diff-index]");
            const start = row(picked.startContainer), end = row(picked.endContainer);
            if (start && end && event.currentTarget.contains(start) && event.currentTarget.contains(end)) choose(Number(start.dataset.diffIndex), Number(end.dataset.diffIndex));
          }}>
          {highlighted ? <div className="p-2"><CodeBlock code={diff.slice("+++ untracked\n".length)} filename={selected.path} language={selected.path.split(".").at(-1) ?? "text"} animateChanges={false} /></div> : diff.length === 0 ? <p className="p-3 ui-control text-text-muted">{emptyDiffMessage ?? t("No textual diff available.")}</p> : <div className={cn("diff-code py-2 leading-5", !wrap && "min-w-max")}>
            {lines.slice(0, mounted).map((line, index) => <DiffRow key={index} line={line} index={index} t={t} wrap={wrap} commentable={!!onComment} onChoose={chooseRow}
              selected={!!activeRange && index >= activeRange.from && index <= activeRange.to}
              ranges={found.byLine.get(index)} current={currentMatch?.line === index ? currentMatch.start : null} />)}
            {more ? <div ref={sentinel} aria-hidden="true" data-diff-pending={lines.length - mounted} style={{ height: reservedDiffHeight(mounted, lines.length) }} /> : null}
          </div>}
        </div>
      </div>
      {activeRange && onComment ? <CommentForm range={activeRange} onComment={onComment} onClear={clearRange} /> : null}
    </>}
  </div>;
}
