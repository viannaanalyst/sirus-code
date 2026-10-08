import { Fragment, memo, useEffect, useMemo, useState, type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Search, X } from "@/components/icons/phosphor";
import { client } from "@/client";
import type { TextSearchFile, TextSearchResult } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";
import { fileIconFor } from "@/lib/file-icons";
import { literalRanges, workspaceFilePath } from "@/lib/file-tree-keys";
import { formatUnknownError } from "@/lib/format-error";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { IconButton } from "@/primitives/IconButton";

/** Text search in the Files pane (ADR-095): debounced, at least two characters, bounded natively. */
export const SEARCH_MIN_LENGTH = 2;
const DEBOUNCE_MS = 200;
const ease = [0.16, 1, 0.3, 1] as const;

export const searchIsActive = (query: string) => query.length >= SEARCH_MIN_LENGTH && query.trim().length > 0;

type FieldProps = {
  open: boolean; query: string; caseSensitive: boolean; input: RefObject<HTMLInputElement | null>;
  onQuery: (query: string) => void; onCaseSensitive: (value: boolean) => void; onClose: () => void; onEnterResults: (open: boolean) => void;
};

/** The field slides in under the pane header and leaves the same way. */
export function FileSearchField({ open, query, caseSensitive, input, onQuery, onCaseSensitive, onClose, onEnterResults }: FieldProps) {
  const t = useTranslation();
  const reduced = useMotionPreferences();
  return <AnimatePresence initial={false}>
    {open ? <motion.div key="file-search" role="search" aria-label={t("explorer.search")} className="shrink-0 overflow-hidden border-b border-border-subtle"
      initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }} animate={reduced ? { opacity: 1 } : { opacity: 1, height: "auto" }}
      exit={reduced ? { opacity: 0, transition: { duration: 0.08 } } : { opacity: 0, height: 0, transition: { duration: 0.1, ease } }}
      transition={{ duration: 0.16, ease }}
>
      <div className="flex h-9 items-center gap-1 px-1.5">
        <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-[7px] border border-border-subtle bg-surface px-2 transition-colors duration-[var(--motion-fast)] focus-within:border-border-default">
          <Search size={13} aria-hidden="true" className="shrink-0 text-text-muted" />
          <input ref={input} type="search" value={query} maxLength={256} spellCheck={false} autoComplete="off" autoCorrect="off"
            aria-label={t("explorer.search.placeholder")} placeholder={t("explorer.search.placeholder")}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
              else if (event.key === "ArrowDown") { event.preventDefault(); onEnterResults(false); }
              else if (event.key === "Enter") { event.preventDefault(); onEnterResults(true); }
            }}
            className="h-full min-w-0 flex-1 bg-transparent ui-control text-text-primary outline-none placeholder:text-text-muted [&::-webkit-search-cancel-button]:hidden" />
        </div>
        <button type="button" aria-pressed={caseSensitive} aria-label={t("explorer.search.matchCase")} title={t("explorer.search.matchCase")}
          onClick={() => onCaseSensitive(!caseSensitive)}
          className={cn("flex size-6 shrink-0 items-center justify-center rounded-[6px] ui-caption font-medium transition-colors duration-[var(--motion-fast)] hover:bg-background-3 hover:text-text-primary", caseSensitive ? "bg-background-3 text-text-primary" : "text-text-muted")}>
          Aa
        </button>
        <IconButton label={t("explorer.search.close")} className="size-6 min-h-0 rounded-[6px] p-0" onClick={onClose}><X size={13} aria-hidden="true" /></IconButton>
      </div>
    </motion.div> : null}
  </AnimatePresence>;
}

/** The last finished search; while a newer one runs its results stay, dimmed. */
type Finished = { key: string; result?: TextSearchResult; error?: string };

type ResultsProps = {
  sessionId: string; root: string; query: string; caseSensitive: boolean;
  list: RefObject<HTMLDivElement | null>;
  onOpen: (path: string, line: number, column: number) => void; onClose: () => void;
};

/** Results grouped by file; a match opens the file in the editor at its line. */
export function FileSearchResults({ sessionId, root, query, caseSensitive, list, onOpen, onClose }: ResultsProps) {
  const t = useTranslation();
  const reduced = useMotionPreferences();
  const key = `${caseSensitive ? "1" : "0"}:${query}`;
  const [finished, setFinished] = useState<Finished | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      client.searchWorkspaceText(sessionId, query, caseSensitive).then((result) => {
        if (!cancelled) { setFinished({ key, result }); setCollapsed(new Set()); }
      }, (cause: unknown) => { if (!cancelled) setFinished({ key, error: formatUnknownError(cause) }); });
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [sessionId, query, caseSensitive, key]);

  const searching = finished?.key !== key;
  const error = searching ? undefined : finished?.error;
  const result = finished?.result;
  const totals = useMemo(() => ({ files: result?.files.length ?? 0, matches: result?.files.reduce((sum, file) => sum + file.matches.length, 0) ?? 0 }), [result]);
  const toggle = (path: string) => setCollapsed((previous) => {
    const next = new Set(previous);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [...(list.current?.querySelectorAll<HTMLElement>("[data-search-result]") ?? [])];
    const index = items.indexOf(event.target as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    items[Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };

  return <motion.div ref={list} className="scroll-thin min-h-0 flex-1 overflow-auto px-1 py-1.5" aria-busy={searching} onKeyDown={onKeyDown}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : 0.14, ease }}>
    <p role="status" className="px-2 pb-1 ui-caption text-text-muted">
      {error ? null
        : totals.matches === 0 ? t(searching ? "explorer.search.searching" : "explorer.search.empty")
          : t("explorer.search.summary", { matches: totals.matches, files: totals.files })}
    </p>
    {error ? <p role="alert" className="px-2 ui-caption text-danger">{t(error)}</p> : null}
    {result?.truncated ? <p className="px-2 pb-1 ui-caption text-text-muted">{t("explorer.search.truncated")}</p> : null}
    <div role="list" aria-label={t("explorer.search.results")} className={cn("transition-opacity duration-[var(--motion-fast)]", searching && "opacity-60")}>
      {error ? null : result?.files.map((file) => <ResultGroup key={file.path} file={file} root={root} query={query} caseSensitive={caseSensitive}
        open={!collapsed.has(file.path)} onToggle={toggle} onOpen={onOpen} />)}
    </div>
  </motion.div>;
}

const ResultGroup = memo(function ResultGroup({ file, root, query, caseSensitive, open, onToggle, onOpen }: {
  file: TextSearchFile; root: string; query: string; caseSensitive: boolean; open: boolean;
  onToggle: (path: string) => void; onOpen: (path: string, line: number, column: number) => void;
}) {
  const t = useTranslation();
  const slash = file.path.lastIndexOf("/");
  const name = file.path.slice(slash + 1);
  const folder = slash > 0 ? file.path.slice(0, slash) : "";
  const spec = fileIconFor(name);
  const absolute = workspaceFilePath(root, file.path);
  return <div role="listitem" className="pb-0.5">
    <button type="button" data-search-result="" aria-expanded={open} title={file.path} onClick={() => onToggle(file.path)}
      className="flex h-7 w-full items-center gap-1 rounded-[6px] px-1.5 text-left ui-control text-text-secondary hover:bg-background-3 hover:text-text-primary focus-visible:outline-offset-[-2px]">
      <ChevronRight size={12} aria-hidden="true" className={cn("shrink-0 transition-transform duration-[var(--motion-fast)]", open && "rotate-90")} />
      <spec.Icon size={13} style={{ color: spec.color }} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-text-primary">{name}</span>
        {folder ? <span className="ml-1.5 ui-caption text-text-muted">{folder}</span> : null}
      </span>
      <span aria-label={t("explorer.search.matchCount", { count: file.matches.length })} className="shrink-0 rounded-full bg-background-3 px-1.5 tabular-nums ui-caption text-text-muted">{file.matches.length}</span>
    </button>
    {open ? <div role="list">
      {file.matches.map((match) => <div role="listitem" key={`${match.line}:${match.column}`}>
        <button type="button" data-search-result="" data-search-match="" title={`${file.path}:${match.line}`} onClick={() => onOpen(absolute, match.line, match.column)}
          className="flex min-h-6 w-full items-baseline gap-2 rounded-[6px] py-0.5 pl-7 pr-1.5 text-left hover:bg-background-3 focus-visible:outline-offset-[-2px]">
          <span aria-label={t("explorer.search.line", { line: match.line })} className="w-8 shrink-0 text-right tabular-nums ui-caption text-text-muted">{match.line}</span>
          <span className="min-w-0 flex-1 truncate font-mono ui-caption text-text-secondary"><Highlighted text={match.text} query={query} caseSensitive={caseSensitive} /></span>
        </button>
      </div>)}
    </div> : null}
  </div>;
});

function Highlighted({ text, query, caseSensitive }: { text: string; query: string; caseSensitive: boolean }) {
  const ranges = literalRanges(text, query, caseSensitive);
  if (!ranges.length) return text;
  let cursor = 0;
  return <>
    {ranges.map((range) => {
      const prefix = text.slice(cursor, range.start);
      cursor = range.end;
      return <Fragment key={range.start}>{prefix}<mark className="rounded-sm bg-accent/25 text-text-primary">{text.slice(range.start, range.end)}</mark></Fragment>;
    })}
    {text.slice(cursor)}
  </>;
}
