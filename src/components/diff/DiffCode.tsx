// The drawing half of the diff viewer (ADR-169): @pierre/diffs' CodeView, which virtualizes the
// files, highlights them in workers, pins file headers and selects lines. Everything the app
// adds around it (find bar, comment form, collapse state, view memory) lives in DiffViewer.tsx;
// this file only turns our model into Pierre items and Pierre's events into ours. It is loaded
// on demand, so the highlighter and its grammars stay out of the main bundle.
import { parseDiffFromFile, type FileDiffMetadata, type SelectedLineRange } from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { ChevronRight } from "@/components/icons";
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { clearFindMatches, lineSelector, paintFindMatches, type RenderedDiffFile } from "@/lib/diff-find-dom";
import type { DiffMatch } from "@/lib/diff-find";
import { addressOfLine, hashText, selectionOfRows } from "@/lib/diff-pierre";
import { DIFF_UNSAFE_CSS, diffThemeName } from "@/lib/diff-theme";
import type { DiffLine } from "@/lib/transcript";
import { DiffWorkerPool, useDiffAppearance } from "./DiffWorkerPool";

/** One file of the document: its text, our parsed rows, Pierre's model, and what to say when there is no text diff. */
export interface DiffEntry { path: string; diff: string; lines: readonly DiffLine[]; fileDiff: FileDiffMetadata | null; message: string | null }

export interface DiffCodeHandle {
  /** Scrolls so the file's header is at the top. */
  jumpToFile(path: string): void;
  /** Scrolls to a row of a file; with `center`, puts it mid-screen unless it is already in view. */
  revealRow(path: string, row: number, options?: { center?: boolean; smooth?: boolean }): void;
  /** The scroll position and the file whose header is at the top. */
  position(): { scrollTop: number; path: string | null };
}

/** A find match placed in a file: `row` is the row index in that file's parsed rows. */
export interface DiffCodeMatch { path: string; row: number; match: DiffMatch; current: boolean }

export interface DiffCodeProps {
  entries: readonly DiffEntry[];
  /** Files get a header (collapse, counts, copy) when there are several. */
  headers: boolean;
  collapsed: ReadonlySet<string>;
  wrap: boolean;
  /** Lines can be chosen for a comment. */
  selectable: boolean;
  /** Rows drawn as selected: the chosen comment range, or the rows a guide points at. */
  selection: { path: string; from: number; to: number } | null;
  matches: readonly DiffCodeMatch[];
  /** Scroll position to start at, or the file to start on. */
  initialTop: number | null;
  initialPath: string | null;
  handle: RefObject<DiffCodeHandle | null>;
  labels: { expand: (path: string) => string; collapse: (path: string) => string; copy: string; region: string; loading: string };
  onToggle: (path: string) => void;
  /** Pierre's selection, as rows of one file; null when it was cleared. */
  onSelect: (selection: { path: string; range: SelectedLineRange } | null) => void;
  onScroll: (scrollTop: number, path: string | null) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

const emptyDiffs = new Map<string, FileDiffMetadata>();
/** A diff without hunks, so a file with no text still gets its header. */
function emptyDiff(path: string): FileDiffMetadata {
  let diff = emptyDiffs.get(path);
  if (!diff) {
    diff = parseDiffFromFile({ name: path, contents: "", cacheKey: `sirus-empty:${path}` }, { name: path, contents: "", cacheKey: `sirus-empty:${path}` });
    if (emptyDiffs.size > 256) emptyDiffs.clear();
    emptyDiffs.set(path, diff);
  }
  return diff;
}

/** The code font's pixel size and a line height for it; phone reviews use taller rows to tap. */
function useRowHeight(host: RefObject<HTMLElement | null>) {
  const [height, setHeight] = useState(20);
  useLayoutEffect(() => {
    const read = () => {
      const root = document.documentElement;
      const size = Number.parseFloat(getComputedStyle(root).getPropertyValue("--code-font-size")) || 13;
      setHeight(host.current?.closest(".mobile-review") ? 26 : Math.max(18, Math.round(size * 1.55)));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-density"] });
    return () => observer.disconnect();
  }, [host]);
  return height;
}

function DiffCodeView({ entries, headers, collapsed, wrap, selectable, selection, matches, initialTop, initialPath, handle, labels, onToggle, onSelect, onScroll, onKeyDown }: DiffCodeProps) {
  const appearance = useDiffAppearance();
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null);
  const host = useRef<HTMLDivElement>(null);
  const rowHeight = useRowHeight(host);
  const byPath = useMemo(() => new Map(entries.map((entry) => [entry.path, entry])), [entries]);

  const items = useMemo(() => entries.map((entry) => {
    const hasBody = entry.fileDiff !== null;
    const closed = !hasBody || (headers && collapsed.has(entry.path));
    return { id: entry.path, type: "diff" as const, fileDiff: entry.fileDiff ?? emptyDiff(entry.path), collapsed: closed, version: Number.parseInt(hashText(entry.diff), 36) * 2 + (closed ? 1 : 0) };
  }), [entries, collapsed, headers]);

  // The user's rows, or the rows a guide points at, as Pierre's selection.
  const selected = useMemo(() => {
    const entry = selection ? byPath.get(selection.path) : undefined;
    const range = entry && selection ? selectionOfRows(entry.lines, selection.from, selection.to) : null;
    return entry && range ? { id: entry.path, range } : null;
  }, [selection, byPath]);

  // Find: matches by file for the files drawn right now, painted after every render of Pierre's.
  const found = useRef({ matches, byPath });
  found.current = { matches, byPath };
  const frame = useRef(0);
  const paint = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const { matches: list, byPath: files } = found.current;
      const rendered = viewer.current?.getInstance()?.getRenderedItems() ?? [];
      const roots: RenderedDiffFile[] = [];
      for (const item of rendered) {
        const root = item.element.shadowRoot, entry = files.get(item.id);
        if (!root || !entry) continue;
        roots.push({ root, lines: entry.lines, matches: list.filter((match) => match.path === item.id).map(({ match, row, current }) => ({ match, row, current })) });
      }
      if (!list.length) clearFindMatches(rendered.flatMap((item) => item.element.shadowRoot ?? []));
      else paintFindMatches(roots);
    });
  }, []);
  useEffect(() => { paint(); return () => cancelAnimationFrame(frame.current); }, [paint, matches, entries, appearance]);
  useEffect(() => () => clearFindMatches(), []);

  const fileAtTop = useCallback((scrollTop: number) => {
    const instance = viewer.current?.getInstance();
    if (!instance || !entries.length) return null;
    let low = 0, high = entries.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((instance.getTopForItem(entries[middle].path) ?? Number.POSITIVE_INFINITY) <= scrollTop + 1) low = middle; else high = middle - 1;
    }
    return entries[low].path;
  }, [entries]);

  const reveal = useCallback((path: string, row: number, options?: { center?: boolean; smooth?: boolean }) => {
    const entry = found.current.byPath.get(path), line = entry?.lines[row];
    const address = line ? addressOfLine(line) : null;
    if (!entry || !line || !address) return;
    const behavior = options?.smooth ? "smooth" : "instant";
    const element = viewer.current?.getInstance()?.getRenderedItems().find((item) => item.id === path)?.element;
    const drawn = (() => { const selector = lineSelector(line); return selector ? element?.shadowRoot?.querySelector(selector) : null; })();
    const box = host.current?.getBoundingClientRect(), rect = drawn?.getBoundingClientRect();
    // Already comfortably in view: leave the scroll alone.
    const margin = headers ? 44 : 8;
    if (drawn && box && rect && rect.top >= box.top + margin && rect.bottom <= box.bottom - 8) return;
    viewer.current?.scrollTo({ type: "line", id: path, lineNumber: address.lineNumber, side: address.side, align: options?.center ? "center" : "nearest", behavior, ...(headers && !options?.center ? { offset: 36 } : {}) });
  }, [headers]);

  useLayoutEffect(() => {
    handle.current = {
      jumpToFile: (path) => viewer.current?.scrollTo({ type: "item", id: path, align: "start", behavior: "instant" }),
      revealRow: reveal,
      position: () => { const top = viewer.current?.getInstance()?.getScrollTop() ?? 0; return { scrollTop: top, path: fileAtTop(top) }; },
    };
    return () => { handle.current = null; };
  }, [handle, reveal, fileAtTop]);

  // Coming back: the place this tab was left at, or the file it was opened on.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !viewer.current) return;
    restored.current = true;
    if (initialTop !== null && initialTop > 0) viewer.current.scrollTo({ type: "position", position: initialTop, behavior: "instant" });
    else if (initialPath && headers && entries[0]?.path !== initialPath) viewer.current.scrollTo({ type: "item", id: initialPath, align: "start", behavior: "instant" });
  }, [initialTop, initialPath, headers, entries]);

  const options = useMemo(() => ({
    diffStyle: "unified" as const,
    overflow: wrap ? ("wrap" as const) : ("scroll" as const),
    theme: diffThemeName(appearance),
    themeType: appearance,
    preferredHighlighter: "highlights" as const,
    tokenizeMaxLineLength: 1000,
    disableFileHeader: !headers,
    stickyHeaders: headers,
    hunkSeparators: "line-info" as const,
    enableLineSelection: selectable,
    unsafeCSS: DIFF_UNSAFE_CSS,
    itemMetrics: { lineHeight: rowHeight, diffHeaderHeight: 36, hunkSeparatorHeight: 24, spacing: 0, paddingTop: 0, paddingBottom: headers ? 8 : 0 },
    layout: { paddingTop: 0, paddingBottom: 0, gap: 0 },
    onPostRender: paint,
  }), [appearance, wrap, headers, selectable, rowHeight, paint]);

  const renderHeaderPrefix = useCallback((item: { id: string; collapsed?: boolean }): ReactNode => {
    const entry = byPath.get(item.id);
    if (!entry?.fileDiff) return null;
    const closed = item.collapsed === true;
    return <button type="button" className="diff-file-toggle" aria-expanded={!closed} aria-label={closed ? labels.expand(item.id) : labels.collapse(item.id)} title={item.id} onClick={() => onToggle(item.id)}>
      <ChevronRight size={13} aria-hidden="true" className="diff-file-chevron" />
    </button>;
  }, [byPath, labels, onToggle]);
  const renderHeaderMetadata = useCallback((item: { id: string }): ReactNode => {
    const entry = byPath.get(item.id);
    if (!entry) return null;
    return <>
      {entry.message && !entry.fileDiff ? <span className="diff-header-note" title={entry.message}>{entry.message}</span> : null}
      {entry.fileDiff ? <CopyButton value={entry.diff} label={labels.copy} iconOnly variant="plain" /> : null}
    </>;
  }, [byPath, labels.copy]);

  return <div ref={host} className="diff-code diff-pierre h-full min-h-0 outline-none" style={{ "--sirus-diff-surface": "var(--background-1)", "--diffs-line-height": `${rowHeight}px` } as React.CSSProperties} tabIndex={0} role="region" aria-label={labels.region} onKeyDown={onKeyDown}>
    <CodeView<undefined>
      ref={viewer}
      className="scroll-thin h-full"
      items={items}
      options={options}
      selectedLines={selected}
      onSelectedLinesChange={(next) => {
        const entry = next ? byPath.get(next.id) : undefined;
        onSelect(next && entry ? { path: entry.path, range: next.range } : null);
      }}
      onScroll={(top) => onScroll(top, fileAtTop(top))}
      renderHeaderPrefix={headers ? renderHeaderPrefix : undefined}
      renderHeaderMetadata={headers ? renderHeaderMetadata : undefined}
    />
  </div>;
}

/** Wraps the viewer in the shared highlighter pool. */
export default function DiffCode(props: DiffCodeProps) {
  return <DiffWorkerPool loading={<p role="status" className="p-3 ui-control text-text-muted">{props.labels.loading}</p>}><DiffCodeView {...props} /></DiffWorkerPool>;
}
