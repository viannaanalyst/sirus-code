import { memo, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "@/components/icons/phosphor";
import { selectListedSessions, useAppStore } from "@/store/app-store";
import { client } from "@/client";
import type { Session } from "@/client/types";
import { searchConversations, type SearchHit } from "@/lib/conversation-search";
import { useTranslation } from "@/i18n/use-translation";
import { IconButton } from "@/primitives/IconButton";
import { SearchText } from "@/components/SearchText";
import { cn } from "@/lib/cn";
import { AnimatePresence, motion } from "motion/react";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import "@/styles/find-bar.css";

function TranscriptSearchBarView({ sessionId }: { sessionId?: string }) {
  const t = useTranslation();
  const search = useAppStore(state => state.transcriptSearch);
  const sessions = useAppStore(selectListedSessions);
  // Only an open search reads the current transcript, so streaming does not re-render a closed bar.
  const current = useAppStore(state => state.transcriptSearch && sessionId ? state.sessions.find(session => session.id === sessionId) : undefined);
  const projects = useAppStore(state => state.projects);
  const jump = useAppStore(state => state.messageJump);
  const update = useAppStore(state => state.updateTranscriptSearch);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const query = useDeferredValue(search?.query ?? "");
  const all = search?.scope === "all";
  // All conversations: native returns bounded candidate messages (transcripts may not be
  // loaded); the exact matching and offsets below stay the same for both scopes.
  const [remote, setRemote] = useState<{ query: string; sessions: Session[]; truncated: boolean } | null>(null);
  useEffect(() => {
    if (!all || !query.trim()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      client.searchTranscripts(query).then(result => {
        if (cancelled) return;
        const known = new Map(useAppStore.getState().sessions.map(session => [session.id, session]));
        setRemote({ query, truncated: result.truncated, sessions: result.sessions.flatMap(candidate => { const meta = known.get(candidate.sessionId); return meta ? [{ ...meta, messages: candidate.messages }] : []; }) });
      }, () => { if (!cancelled) setRemote({ query, sessions: [], truncated: false }); });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [all, query]);
  const result = useMemo(() => {
    if (!all) return searchConversations(current && projects.some(project => project.id === current.projectId) ? [current] : [], query, sessionId ?? "");
    if (!remote || remote.query !== query) return { hits: [], truncated: false };
    const found = searchConversations(remote.sessions.filter(session => projects.some(project => project.id === session.projectId)), query);
    return { hits: found.hits, truncated: found.truncated || remote.truncated };
  }, [all, current, remote, projects, query, sessionId]);
  const active = result.hits.findIndex(hit => hit.sessionId === jump?.sessionId && hit.messageId === jump?.messageId && hit.start === jump?.searchStart);
  const revision = search?.revision;
  useLayoutEffect(() => { if (revision !== undefined) { input.current?.focus(); input.current?.select(); } }, [revision]);
  useLayoutEffect(() => { root.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: "nearest" }); }, [jump]);
  const reduced = useMotionPreferences();
  const close = () => {
    useAppStore.getState().closeTranscriptSearch();
    root.current?.closest("section")?.querySelector<HTMLTextAreaElement>("textarea[data-draft-owner]")?.focus({ preventScroll: true });
  };
  const navigate = (hit: SearchHit) => {
    useAppStore.getState().jumpToMessage(hit.sessionId, hit.messageId, hit.start);
    // Keep repeated Enter navigation in the search field after the transcript jump.
    requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
  };
  const step = (direction: number) => {
    if (!result.hits.length) return;
    navigate(result.hits[(active < 0 ? direction > 0 ? 0 : result.hits.length - 1 : (active + direction + result.hits.length) % result.hits.length)]);
  };
  const keys = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === "Enter" && event.target === input.current) { event.preventDefault(); step(event.shiftKey ? -1 : 1); }
  };
  // ⌘F: a small floating find bar over the current conversation, like a browser's.
  if (!all) return <AnimatePresence>{search ? <motion.div key="find" ref={root} role="search" aria-label={t("search.find")} className="find-bar" onKeyDown={keys}
    initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.1 } }} transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}>
    <Search size={15} aria-hidden="true" className="shrink-0 text-text-muted" />
    <input ref={input} type="search" autoComplete="off" autoCorrect="off" spellCheck={false} aria-label={t("search.find")} placeholder={t("search.find")} maxLength={256} value={search.query} onChange={event => update({ query: event.target.value })} className="find-bar-input ui-control" />
    {query.trim() ? <span role="status" className="shrink-0 tabular-nums ui-caption text-text-muted">{result.hits.length ? `${active + 1}/${result.hits.length}${result.truncated ? "+" : ""}` : "0/0"}</span> : null}
    <IconButton label={t("search.previous")} disabled={!result.hits.length} onClick={() => step(-1)}><ChevronUp size={14} /></IconButton>
    <IconButton label={t("search.next")} disabled={!result.hits.length} onClick={() => step(1)}><ChevronDown size={14} /></IconButton>
    <IconButton label={t("search.close")} onClick={close}><X size={14} /></IconButton>
  </motion.div> : null}</AnimatePresence>;
  if (!search) return null;
  return <div ref={root} role="search" aria-label={t("search.conversations")} className="shrink-0 border-b border-border-subtle px-3 py-2"
    onKeyDown={keys}>
    <div className="flex flex-wrap items-center gap-1.5">
      <Search size={14} aria-hidden="true" className="text-text-muted" />
      <input ref={input} type="search" aria-label={t("search.messages")} placeholder={t("search.messages")} maxLength={256} value={search.query} onChange={event => update({ query: event.target.value })} className="min-w-24 flex-1 rounded-[7px] bg-background-2 px-2 py-1 ui-control text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent" />
      <select aria-label={t("search.scope")} value={search.scope} onChange={event => update({ scope: event.target.value as "session" | "all" })} className="max-w-full rounded-[7px] bg-background-2 px-2 py-1 ui-caption text-text-secondary">
        <option value="session" disabled={!sessionId}>{t("search.current")}</option><option value="all">{t("search.all")}</option>
      </select>
      <IconButton label={t("search.previous")} disabled={!result.hits.length} onClick={() => step(-1)}><ChevronUp size={14} /></IconButton>
      <IconButton label={t("search.next")} disabled={!result.hits.length} onClick={() => step(1)}><ChevronDown size={14} /></IconButton>
      <IconButton label={t("search.close")} onClick={close}><X size={14} /></IconButton>
    </div>
    <p role="status" className="pt-1 ui-micro text-text-muted">{query.trim() ? result.hits.length ? t("search.count", { position: active + 1, count: result.hits.length, extra: result.truncated ? "+" : "" }) : t("search.none") : t("search.hint")}</p>
    {result.hits.length ? <ol className="scroll-thin mt-1 max-h-32 overflow-auto" aria-label={t("search.results")}>{result.hits.map((hit, index) => {
      const session = sessions.find(session => session.id === hit.sessionId);
      const project = projects.find(project => project.id === session?.projectId);
      return <li key={`${hit.sessionId}:${hit.messageId}:${hit.start}`}><button type="button" aria-current={index === active ? "true" : undefined} onClick={() => navigate(hit)} className={cn("block w-full rounded-[7px] px-2 py-1 text-left hover:bg-background-3 focus-visible:outline-accent", index === active && "bg-background-3")}>
        {search.scope === "all" ? <span className="block truncate ui-micro text-text-muted">{project?.name} · {session?.title}</span> : null}
        <span className="block truncate ui-caption text-text-secondary"><SearchText text={hit.snippet} query={query} /></span>
      </button></li>;
    })}</ol> : null}
  </div>;
}

/** Memoized so the parent transcript re-rendering per frame does not re-run the search. */
export const TranscriptSearchBar = memo(TranscriptSearchBarView);
