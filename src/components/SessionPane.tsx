import { CodeBlock } from "@/components/arc/code-block/code-block";

/** Finished code blocks in a streaming message keep their render (and their header motion). */
const TranscriptCodeBlock = memo(CodeBlock);
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { MessageActions, MessageTimestamp } from "@/components/MessageActions";
import { ChevronDown, GitFork, RotateCcw, TerminalSquare } from "@/components/icons/phosphor";
import { formatUnknownError } from "@/lib/format-error";
import "@/styles/context-meter.css";
import { TranscriptSearchBar } from "@/components/TranscriptSearchBar";
import { SearchText } from "@/components/SearchText";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { StatusIndicator } from "@/primitives/StatusIndicator";
import { createTranscriptScroll, messageSizeStyle, scrollWithin } from "@/lib/transcript-scroll";
import { parseTranscript } from "@/lib/transcript";
import { isConversationStarted } from "@/lib/appearance";
import { cn } from "@/lib/cn";
import { motionTokens } from "@/lib/motion";
import { useTranslation } from "@/i18n/use-translation";
import { motion } from "motion/react";
import { Fragment, memo, startTransition, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { FIRST_PAINT_TURNS, INITIAL_TURNS, LOAD_EARLIER_THRESHOLD, nextTurnCount, prependedScrollTop, turnStarts, turnsToReveal, windowStart } from "@/lib/turn-window";
import { sameRowProps } from "@/lib/transcript-row";
import { MessageTrail } from "@/components/MessageTrail";
import { TranscriptSelectionMenu } from "@/components/TranscriptSelectionMenu";
import { TurnChangeSummary } from "@/components/TurnChangeSummary";
import { TeamPanel } from "@/components/TeamPanel";
import { stripTeamPlan } from "@/lib/team";
import { hasConversation } from "@/lib/transcripts";
import { useSmoothText } from "@/lib/use-smooth-text";
import { splitPromptContext } from "@/lib/prompt-context";
import { smallThumbnailUrl, thumbnailUrl } from "@/lib/thumbnail-url";
import { PlanActions, QUICK_REPLY_EVENT, ReplyChoices, type QuickReplyDetail } from "@/components/ReplyChoices";
import { BackgroundTasks } from "@/components/BackgroundTasks";
import { ImageLightbox } from "@/components/ImageLightbox";
import { AstroReplyExtras } from "@/components/astros/AstroReplyExtras";
import { FileTypeIcon, fileKind, formatFileSize } from "@/components/FileTypeIcon";
import { HtmlPreview } from "@/components/HtmlPreview";
import { composerSegments, hasComposerTokens } from "@/lib/composer-tokens";
import { AgentActivity } from "@/components/AgentActivity";
import { AgentRequests } from "@/components/AgentRequests";
import { AgentComposer } from "@/components/AgentComposer";
import { ChatMarkdown, openLink } from "@/components/ChatMarkdown";
import { WORKING_PANEL_MIN_WIDTH, WORKING_PANEL_WIDTH, WorkingPanel } from "@/components/WorkingPanel";
import { splitLinks } from "@/lib/link-text";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { LandingControls } from "@/components/LandingControls";
import { HandoffMarker } from "@/components/HandoffMarker";
import { ProviderSwitchScene } from "@/components/ProviderSwitchScene";
import { AstroIcon } from "@/components/astros/AstroArt";
import { AstroHeader } from "@/components/astros/AstroHeader";
import { AstroCards } from "@/components/astros/AstroCard";
import type { ExecutionOptions, Message, Session } from "@/client/types";
import { client } from "@/client";
import type { AgentInstall, AgentProviderId } from "@/client/types";
import { selectCurrentProject, selectCurrentSession, selectCurrentSessionMeta, useAppStore } from "@/store/app-store";

const noSteers: { offset: number; text: string }[] = [];
// A running turn re-renders every second and on each streamed frame; its finished
// paragraphs parse once instead of on every render.
const parsedText = new Map<string, ReturnType<typeof parseTranscript>>();
function parseCached(text: string) {
  let blocks = parsedText.get(text);
  if (!blocks) {
    if (parsedText.size >= 64) parsedText.delete(parsedText.keys().next().value!);
    blocks = parseTranscript(text);
    parsedText.set(text, blocks);
  }
  return blocks;
}

interface Props {
  agents: AgentInstall[];
  onSend: (prompt: string, execution?: ExecutionOptions) => Promise<boolean>;
  onStop: () => void;
  onNewSession: () => void;
  onModelChange?: (provider: AgentProviderId, model: string | null) => void;
  /**
   * An inactive side-by-side pane: it shows `sessionId` read-only and the first
   * use makes it the active pane (the selected session), which owns the composer.
   */
  passive?: boolean;
  sessionId?: string | null;
}

export function SessionPane({ agents, onSend, onStop, onModelChange, passive = false, sessionId = null }: Props) {
  const t = useTranslation();
  const selected = useAppStore(selectCurrentSession);
  const bound = useAppStore((state) => passive && sessionId ? state.sessions.find((item) => item.id === sessionId) ?? null : null);
  const session = passive ? bound : selected;
  // Controls below the transcript never read messages: they skip per-frame renders.
  const sessionMeta = useAppStore(selectCurrentSessionMeta);
  const openProject = useAppStore((state) => state.addProjectFromPicker);
  const selectedProject = useAppStore(selectCurrentProject);
  const boundProject = useAppStore((state) => passive ? state.projects.find((item) => item.id === bound?.projectId) ?? null : null);
  const project = passive ? boundProject : selectedProject;
  const jump = useAppStore((state) => state.messageJump);
  const jumpToMessage = useAppStore((state) => state.jumpToMessage);
  const search = useAppStore(state => passive ? null : state.transcriptSearch);
  const searchQuery = useDeferredValue(search?.query ?? "");
  const source = useAppStore((state) => state.sessions.find((item) => item.id === session?.forkOrigin?.sourceSessionId));
  // A transcript that is still loading is not an empty conversation (ADR-048).
  const empty = !session || !hasConversation(session);
  const transcript = useRef<HTMLDivElement>(null);
  const messageNodes = useRef(new Map<string, HTMLElement>());
  const transcriptContent = useRef<HTMLDivElement>(null);
  const latestTurn = useRef<HTMLDivElement>(null);
  const scrolling = useRef<ReturnType<typeof createTranscriptScroll> | null>(null);
  const messages = useMemo(() => session?.messages.filter(message => message.role !== "system") ?? [], [session?.messages]);
  const astro = useAppStore((state) => session?.astro ? state.astros?.find((item) => item.id === session.astro) ?? null : null);
  // Replies to a standalone `/compact` read as a compaction, not as an empty answer (ADR-057).
  const compactions = useMemo(() => new Set(messages.filter((message, index) => message.role === "agent" && messages[index - 1]?.role === "user" && messages[index - 1].content.trim() === "/compact").map((message) => message.id)), [messages]);
  // Where another provider answered: compare each reply's provider with the one before
  // (or, for a handoff session, the provider it was handed off from).
  const providerChanges = useMemo(() => {
    const changes = new Map<string, { from: AgentProviderId; to: AgentProviderId }>();
    let previous: AgentProviderId | null = session?.handoff?.from ?? null;
    messages.forEach((message, index) => {
      if (message.role !== "agent") return;
      const provider = message.activity?.provider ?? (message.streaming && index === messages.length - 1 ? session?.agent ?? null : null);
      if (!provider) return;
      if (previous && previous !== provider) changes.set(message.id, { from: previous, to: provider });
      previous = provider;
    });
    return changes;
  }, [messages, session?.handoff?.from, session?.agent]);
  const latestUserIndex = messages.reduce((last, message, index) => message.role === "user" ? index : last, -1);
  const latestUserId = messages[latestUserIndex]?.id;
  const [following, setFollowing] = useState(true);
  // Only the last turns are mounted (after MonoCode): the latest few on first paint, then
  // INITIAL_TURNS in a transition, and earlier pages on request. Each session starts over.
  const sessionKey = session?.id ?? null;
  const [turnWindow, setTurnWindow] = useState({ sessionId: sessionKey, turns: FIRST_PAINT_TURNS });
  const shownTurns = turnWindow.sessionId === sessionKey ? turnWindow.turns : FIRST_PAINT_TURNS;
  const starts = useMemo(() => turnStarts(messages), [messages]);
  const start = Math.min(windowStart(starts, shownTurns), Math.max(0, latestUserIndex));
  const hiddenTurns = Math.max(0, starts.length - shownTurns);
  // Where the first mounted row sat (in scroll coordinates) before turns were added above it.
  const prependAnchor = useRef<{ id: string; offset: number } | null>(null);
  const loadingEarlier = useRef(false);
  const live = useRef({ messages, starts, shownTurns, sessionKey, start });
  live.current = { messages, starts, shownTurns, sessionKey, start };
  const rememberFirstRow = useCallback(() => {
    const viewport = transcript.current, first = live.current.messages[live.current.start];
    const node = first && messageNodes.current.get(first.id);
    if (!viewport || !node) return;
    prependAnchor.current = { id: first.id, offset: node.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop };
  }, []);
  /** Turns needed to mount `messageId`, or 0 when it is already mounted or unknown. */
  const turnsFor = useCallback((messageId: string) => {
    const { messages: all, starts: turns, shownTurns: shown } = live.current;
    const needed = turnsToReveal(turns, all.findIndex((message) => message.id === messageId));
    return needed > shown ? needed : 0;
  }, []);
  const loadEarlier = useCallback(() => {
    const { starts: turns, shownTurns: shown, sessionKey: key } = live.current;
    if (shown >= turns.length || loadingEarlier.current) return;
    loadingEarlier.current = true;
    rememberFirstRow();
    setTurnWindow({ sessionId: key, turns: nextTurnCount(shown, turns.length) });
  }, [rememberFirstRow]);
  useEffect(() => {
    // Interruptible, so switching away before it finishes costs nothing.
    if (live.current.starts.length > live.current.shownTurns) rememberFirstRow();
    startTransition(() => setTurnWindow((current) => ({ sessionId: sessionKey, turns: current.sessionId === sessionKey ? Math.max(current.turns, INITIAL_TURNS) : INITIAL_TURNS })));
  }, [sessionKey, rememberFirstRow]);
  const navigateMessage = useCallback((messageId: string) => {
    // A trail tick can point above the mounted turns: widen first, synchronously.
    const needed = turnsFor(messageId);
    if (needed) { rememberFirstRow(); flushSync(() => setTurnWindow({ sessionId: live.current.sessionKey, turns: needed })); }
    const node = messageNodes.current.get(messageId);
    if (!node) return;
    scrolling.current?.detach();
    if (transcript.current) scrollWithin(transcript.current, node, "start");
    node.focus({ preventScroll: true });
  }, [turnsFor, rememberFirstRow]);
  useLayoutEffect(() => {
    const viewport = transcript.current, content = transcriptContent.current, tail = latestTurn.current;
    if (!viewport || !content || !tail) return;
    const controller = createTranscriptScroll(viewport, content, tail, setFollowing);
    scrolling.current = controller;
    setFollowing(true);
    return () => { controller.dispose(); scrolling.current = null; };
  }, [session?.id, empty]);
  // Turns mounted above keep the reader's place: the former first row returns to where it was,
  // before the follow/anchor logic runs, so the anchor it captured stays valid.
  useLayoutEffect(() => {
    const anchor = prependAnchor.current, viewport = transcript.current;
    prependAnchor.current = null;
    loadingEarlier.current = false;
    const node = anchor && messageNodes.current.get(anchor.id);
    if (!anchor || !viewport || !node) return;
    const offset = node.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
    const next = prependedScrollTop(viewport.scrollTop, anchor.offset, offset);
    if (next !== viewport.scrollTop) viewport.scrollTop = next;
  }, [start]);
  useLayoutEffect(() => { scrolling.current?.update(latestUserId); }, [latestUserId, session?.messages, start]);
  // A jump handled once is not replayed while the reader stays in the session.
  const handledJump = useRef<typeof jump>(null);
  useLayoutEffect(() => { handledJump.current = null; }, [session?.id]);
  useLayoutEffect(() => {
    if (jump?.sessionId !== session?.id || !jump || handledJump.current === jump) return;
    // The target can sit above the mounted turns: widen, and this runs again once it is mounted.
    const needed = turnsFor(jump.messageId);
    if (needed) { setTurnWindow({ sessionId: jump.sessionId, turns: needed }); return; }
    const node = messageNodes.current.get(jump.messageId);
    if (!node) return;
    handledJump.current = jump;
    scrolling.current?.detach();
    const hit = jump.searchStart === undefined ? null : node.querySelector<HTMLElement>(`[data-search-start="${jump.searchStart}"]`);
    if (transcript.current) scrollWithin(transcript.current, hit ?? node, "center");
    node.focus({ preventScroll: true });
  }, [jump, session?.id, shownTurns, starts, turnsFor]);
  const title = passive && !session ? t("split.newConversation") : project ? t("session.workOn", { project: project.name }) : t("session.workOnEmpty");

  const landing = empty && !passive && !astro;
  return (
    <section className={cn("session-pane relative flex min-h-0 min-w-0 flex-1 flex-col", !passive && !isConversationStarted(session) && "dot-grid")} data-empty={!isConversationStarted(session) || undefined}>
      {passive ? null : <ProviderSwitchScene owner={session?.id ?? "landing"} />}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        {astro && !passive ? <AstroHeader astro={astro} /> : null}
        {passive ? null : <TranscriptSearchBar sessionId={session?.id} />}
        {session?.lastError && !session.usageLimit ? <p role="alert" className="px-6 pt-3 ui-control text-danger">{t(session.lastError)}</p> : null}
        {session?.forkOrigin ? <div className="mx-auto flex w-full max-w-[var(--chat-column-width)] items-center gap-2 px-3 pt-2 ui-caption text-text-muted"><GitFork aria-hidden="true" size={13} /><span>{t("Fork of {title}", { title: session.forkOrigin.sourceTitle })}</span>{source ? <InteractiveButton variant="toolbar" className="ml-auto shrink-0" onClick={() => jumpToMessage(source.id, session.forkOrigin!.sourceMessageId)}>{t("View original")}</InteractiveButton> : <span>{t("Original session removed")}</span>}</div> : null}
        {/* A new thread, after MonoCode: the question sits left-aligned over the composer, both a little above the middle. */}
        {landing ? <div className="flex min-h-0 flex-1 flex-col justify-end">
          <div className="px-6 pb-3"><div className="mx-auto w-full max-w-[var(--chat-column-width)] pl-3">
            <h2 className="ui-title text-left text-text-primary">{title}</h2>
            {!project ? <button type="button" onClick={() => void openProject()} className="mt-2 ui-body text-accent">{t("project.open")}</button> : null}
          </div></div>
        </div> : empty ? (
          <div className="relative flex min-h-0 flex-1 flex-col items-center overflow-hidden px-8">
            <div className="relative z-10 flex flex-1 flex-col items-center justify-center">
              {astro ? <>
                <div className="mb-4"><AstroIcon icon={astro.icon} style={astro.style} color={astro.color} size={passive ? 44 : 72} /></div>
                <h2 className="ui-title text-text-primary">{t("astros.composer", { name: astro.name })}</h2>
              </> : <>
              <img data-landing-glyph={passive ? undefined : ""} src="/sirus-glyph.png" alt="" draggable={false} className={cn("mb-4 w-auto opacity-95", passive ? "h-[36px]" : "h-[54px]")} />
              <h2 className="ui-title text-text-primary">{title}</h2>
              </>}
              {!project && !passive ? <button type="button" onClick={() => void openProject()} className="mt-4 ui-body text-accent">{t("project.open")}</button> : null}
            </div>
          </div>
        ) : (
          <div className="transcript-shell relative flex min-h-0 flex-1 flex-col">
              <motion.div
                ref={transcript}
                tabIndex={0}
                role="region"
                aria-label={t("session.transcript")}
                onScroll={(event) => {
                  scrolling.current?.scroll();
                  // Reading up towards the first mounted turn brings in the page before it.
                  if (hiddenTurns && !following && event.currentTarget.scrollTop < LOAD_EARLIER_THRESHOLD) loadEarlier();
                }}
                onWheel={(event) => scrolling.current?.interact(event.deltaY)}
                onTouchMove={() => scrolling.current?.interact()}
                onPointerDown={() => scrolling.current?.interact()}
                onKeyDown={() => scrolling.current?.interact()}
                key={session.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: motionTokens.fast, ease: motionTokens.ease }}
                className="transcript-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-6 focus-visible:outline-none"
              >
                {/* Outside the content: the scroll anchor treats the content's grandchildren as rows. */}
                {hiddenTurns ? <div className="mx-auto mb-[var(--chat-message-gap)] flex w-full max-w-[var(--chat-column-width)] shrink-0 justify-center">
                  <InteractiveButton variant="toolbar" onClick={loadEarlier}>{t("session.showEarlier")}</InteractiveButton>
                </div> : null}
                <div ref={transcriptContent} className="mx-auto flex w-full shrink-0 max-w-[var(--chat-column-width)] flex-col gap-[var(--chat-message-gap)]">
                  {[messages.slice(start, Math.max(start, latestUserIndex)), messages.slice(Math.max(start, latestUserIndex))].map((group, groupIndex) => groupIndex === 0 && group.length === 0 ? null : <div key={groupIndex} ref={groupIndex === 1 ? latestTurn : undefined} className="flex shrink-0 flex-col gap-[var(--chat-message-gap)]" data-latest-turn={groupIndex === 1 || undefined}>
                  {group.map((message) => {
                    const change = providerChanges.get(message.id);
                    return <Fragment key={message.id}>
                      {change ? <HandoffMarker sessionId={session.id} from={change.from} to={change.to} live={message.streaming && !passive} /> : null}
                      <TranscriptMessage message={message} session={session} searchQuery={searchQuery} nodes={messageNodes} compacted={compactions.has(message.id)} last={session.messages.at(-1)?.id === message.id} />
                      {message === messages[messages.length - 1] && !passive ? <><PlanActions session={session} message={message} />{emptyReply(message, session) ? <EmptyReplyNotice sessionId={session.id} /> : null}</> : null}
                    </Fragment>;
                  })}
                  </div>)}
                </div>
              </motion.div>
              <MessageTrail key={`trail:${session.id}`}messages={messages} viewport={transcript} content={transcriptContent} nodes={messageNodes} onSelect={navigateMessage} />
              {passive ? null : <TranscriptSelectionMenu key={`selection:${session.id}`} sessionId={session.id} viewport={transcript} />}
          </div>

        )}
        {/* The jump arrow floats just above whatever sits on top of the bottom stack (requests, composer). */}
        <div className="follow-latest-anchor">
          {!empty && !following ? <button type="button" aria-label={t("session.followLatest")} title={t("session.followLatest")} className="follow-latest" onClick={() => {
            scrolling.current?.follow();
          }}><ChevronDown size={13} aria-hidden="true" /></button> : null}
        </div>
        {sessionMeta && !passive ? <AgentRequests session={sessionMeta} /> : null}
        {empty && project && !passive && !astro && !session?.handoff?.pending ? <LandingControls /> : null}
        <div className="relative z-10 px-6 pb-4">
          {passive || !session ? null : <ReplyChoices session={session} message={messages[messages.length - 1]} />}
          {passive || !session ? null : <BackgroundTasks session={session} message={messages[messages.length - 1]} />}
          {passive ? <PassiveComposer session={session} /> : <AgentComposer session={sessionMeta} agents={agents} onSend={onSend} onStop={onStop} onModelChange={onModelChange} />}
          {/* The Working panel floats at the bottom-left, in the room beside the composer; it never moves it (ADR-094). */}
          {passive ? null : <WorkingDock />}
        </div>
        {landing ? <div className="flex-[1.15]" aria-hidden="true" /> : null}
      </div>
    </section>
  );
}

/** Places the Working panel in the free space left of the centred composer, and hides it when that space is too narrow. */
function WorkingDock() {
  const node = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const dock = node.current;
    const row = dock?.parentElement;
    const composer = row?.querySelector<HTMLElement>(".agent-composer");
    if (!row || !composer) return;
    // Space between the row's padding edge and the composer, less a gap.
    const measure = () => setRoom(Math.floor(composer.getBoundingClientRect().left - row.getBoundingClientRect().left - 24 - 16));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    observer.observe(composer);
    return () => observer.disconnect();
  }, []);
  const fits = room >= WORKING_PANEL_MIN_WIDTH;
  return <div ref={node} className="absolute bottom-4 left-6" style={fits ? { width: Math.min(room, WORKING_PANEL_WIDTH) } : { display: "none" }}><WorkingPanel /></div>;
}

/** Stands in for the composer of an inactive pane; using it activates the pane (see SplitWorkspace). */
function PassiveComposer({ session }: { session: Session | null }) {
  const t = useTranslation();
  return <button type="button" className="split-passive-composer ui-body">
    <span className="truncate text-text-muted">{t(session?.status === "waiting" ? "split.waiting" : "split.reply")}</span>
    {session && ["starting", "running", "waiting"].includes(session.status) ? <span className="ml-auto shrink-0"><StatusIndicator status={session.status} /></span> : null}
  </button>;
}

/**
 * One transcript row. Memoized so a streamed chunk re-renders only the message
 * it changed, not every earlier message and its parsed code blocks.
 */
const TranscriptMessage = memo(function TranscriptMessage({ message, session, searchQuery, nodes, compacted = false, last = false }: {
  message: Message;
  session: Session;
  searchQuery: string;
  nodes: RefObject<Map<string, HTMLElement>>;
  compacted?: boolean;
  last?: boolean;
}) {
  const t = useTranslation();
  const register = useCallback((node: HTMLElement | null) => {
    if (node) nodes.current.set(message.id, node); else nodes.current.delete(message.id);
  }, [nodes, message.id]);
  // A reply is cut where the person steered it, so each instruction shows where it arrived.
  // A streaming reply comes out at a steady pace rather than in the provider's bursts.
  const shownContent = useSmoothText(message.content, message.role === "agent" && message.streaming);
  const segments = useMemo(() => {
    if (message.role !== "agent" || !shownContent) return null;
    const team = session.team?.messageId === message.id;
    const content = team ? stripTeamPlan(shownContent) : shownContent;
    const steers = team ? [] : message.steers ?? [];
    const parts: { start: number; blocks: ReturnType<typeof parseTranscript>; steer?: string }[] = [];
    let start = 0;
    for (const steer of steers) {
      const cut = Math.max(start, Math.min(steer.offset, content.length));
      parts.push({ start, blocks: cut > start ? parseTranscript(content.slice(start, cut)) : [], steer: steer.text });
      // The reply resumes after the instruction without the blank lines between its items.
      start = cut;
      while (content[start] === "\n") start += 1;
    }
    parts.push({ start, blocks: start < content.length ? parseTranscript(content.slice(start)) : [] });
    return parts;
  }, [message.role, shownContent, message.id, message.steers, session.team?.messageId]);
  // A sent prompt shows what the person wrote; attachments appear as chips, not as the agent's reference block.
  const { request: userRequest, references: userReferences } = useMemo(() => message.role === "user" ? splitPromptContext(message.content) : { request: message.content, references: [] }, [message.role, message.content]);
  // Images show as thumbnails on top (MonoCode-style); other files and older messages as chips.
  // One stable list, so the lightbox keeps its place while moving between the message's photos.
  const gallery = useMemo(() => (message.attachments ?? []).flatMap((file) => { const src = thumbnailUrl(file); return src ? [{ src, small: smallThumbnailUrl(file) ?? src, name: file.name }] : []; }), [message.attachments]);
  const userImages = gallery;
  const [openImage, setOpenImage] = useState<number | null>(null);
  const userFiles: { name: string; kind: "file" | "folder" | "terminal"; mimeType?: string; size?: number }[] = message.attachments?.length
    ? [...message.attachments.filter((file) => !thumbnailUrl(file)), ...userReferences.filter((reference) => reference.kind === "terminal")]
    : userReferences;
  const team = session.team?.messageId === message.id;
  const replyContent = message.role === "agent" ? (team ? stripTeamPlan(shownContent) : shownContent) : "";
  const replySteers = team ? noSteers : message.steers ?? noSteers;
  /** Reply blocks from `base` in the reply, so search highlights keep their offsets. */
  const renderBlocks = (blocks: ReturnType<typeof parseTranscript>, base: number) => {
    let offset = base;
    return blocks.map((block, index) => {
      const start = offset;
      offset += block.content.length + 1;
      if (block.kind === "code" && block.language.toLowerCase() === "sirus-card" && session.astro && !message.streaming && !searchQuery.trim()) return <AstroCards key={index} source={block.content} session={session} settled={!message.streaming} />;
      if (block.kind === "code" && block.language.toLowerCase() === "html" && !message.streaming && !searchQuery.trim()) return <div className="my-3" key={index}><HtmlPreview source={block.content} /></div>;
      if (block.kind === "code" && block.language.toLowerCase() === "mermaid" && !message.streaming && !searchQuery.trim()) return <div className="my-3" key={index}><MermaidDiagram source={block.content} /></div>;
      if (block.kind === "code") return <div className="my-3" key={index}><TranscriptCodeBlock code={block.content} language={block.language} maxLines={searchQuery.trim() ? undefined : 18} animateChanges={false} searchQuery={searchQuery} searchOffset={start} /></div>;
      // Search highlights need the raw text offsets, so a search shows the reply unformatted.
      return searchQuery.trim() ? <p key={index} className="whitespace-pre-wrap"><SearchText text={block.content} query={searchQuery} offset={start} /></p> : <ChatMarkdown key={index} text={block.content} sessionId={session.id} cwd={session.worktree.path} />;
    });
  };
  return (
    <article data-message-id={message.id} ref={register} tabIndex={-1} style={messageSizeStyle(message)} className={`selectable min-w-0 rounded-[7px] outline-none ${message.role === "user" ? "group/user flex max-w-[85%] flex-col items-end self-end" : "w-full self-start"}`}>
      <p className="sr-only">
        {t(message.role === "user" ? "You" : "Agent")}
      </p>
      <div
        data-transcript-text
        className={`min-w-0 max-w-full whitespace-pre-wrap ui-chat [overflow-wrap:anywhere] ${
          message.role === "user" ? "rounded-[18px] bg-[var(--chat-bubble)] px-4 py-2.5 text-text-primary" : "text-text-secondary"
        }`}
      >
        {message.role === "agent" && message.activity ? <AgentActivity activity={message.activity} content={replyContent} steers={replySteers} cwd={session.worktree.path}
          onResume={last ? (text) => window.dispatchEvent(new CustomEvent<QuickReplyDetail>(QUICK_REPLY_EVENT, { detail: { sessionId: session.id, text } })) : undefined}
          renderText={(start, end) => renderBlocks(parseCached(replyContent.slice(start, end)), start)}
          renderSteer={(text) => <div className="my-3 flex justify-end"><div className="max-w-[85%] rounded-[18px] bg-[var(--chat-bubble)] px-4 py-2.5 text-text-primary"><span className="mb-0.5 block ui-caption text-text-muted">{t("steer.label")}</span>{text}</div></div>} />
        : message.content ? (message.role === "agent" ? (segments ?? []).map((segment, part) => {
          const offset = segment.start;
          return <Fragment key={part}>
            {renderBlocks(segment.blocks, offset)}
            {segment.steer !== undefined ? <div className="my-3 flex justify-end"><div className="max-w-[85%] rounded-[18px] bg-[var(--chat-bubble)] px-4 py-2.5 text-text-primary"><span className="mb-0.5 block ui-caption text-text-muted">{t("steer.label")}</span>{segment.steer}</div></div> : null}
          </Fragment>;
        }) : <>
          {userImages.length ? <span className="prompt-thumbnails">{userImages.map((file, index) => <button key={index} type="button" className="prompt-thumbnail-button" aria-label={file.name} title={file.name} onClick={() => setOpenImage(index)}><img src={file.small} alt="" decoding="async" loading="lazy" className="prompt-thumbnail" draggable={false} /></button>)}</span> : null}
          {searchQuery.trim() ? <SearchText text={userRequest} query={searchQuery} />
            : hasComposerTokens(userRequest) ? composerSegments(userRequest).map((segment, index) => segment.kind === "text" ? <LinkedText key={index} text={segment.text} /> : <span key={index} className={`composer-token composer-token-${segment.kind}`}>{segment.text}</span>)
            : <LinkedText text={userRequest} />}
          {userFiles.length ? <span className="prompt-references">{userFiles.map((reference, index) => reference.kind === "terminal"
            ? <span key={index} className="prompt-reference ui-caption"><TerminalSquare size={13} aria-hidden="true" /><span className="truncate">{reference.name}</span></span>
            : <span key={index} className="attachment-chip attachment-chip-static" title={reference.name}><span className="attachment-chip-open">
              <FileTypeIcon kind={fileKind(reference.name, reference.kind, reference.mimeType)} size={18} />
              <span className="attachment-chip-name">{reference.name}</span>
              {reference.size !== undefined ? <span className="attachment-chip-size">{formatFileSize(reference.size)}</span> : null}
            </span></span>)}</span> : null}
        </>) : compacted && !message.streaming ? <span className="text-text-muted">✓ {t("context.compacted")}</span> : (message.activity ? null : message.streaming ? "…" : t("session.noOutput"))}
      </div>
      {userImages.length ? <ImageLightbox images={openImage === null ? null : gallery} index={openImage ?? 0} onClose={() => setOpenImage(null)} /> : null}
      {message.role === "user" && message.content && !message.streaming ? <div className="pointer-events-none mt-1 flex min-h-6 items-center justify-end gap-1.5 px-2 text-text-muted opacity-0 group-hover/user:pointer-events-auto group-hover/user:opacity-100 group-focus-within/user:pointer-events-auto group-focus-within/user:opacity-100 motion-safe:transition-opacity motion-safe:duration-[var(--motion-fast)] [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
        <CopyButton value={userRequest} label={t("Copy message")} iconOnly variant="plain" className="size-6 min-h-0 text-text-muted [&_svg]:size-[13px]" />
        <MessageTimestamp createdAt={message.createdAt} />
      </div> : null}
      {message.role === "agent" && !message.streaming && message.activity?.endedAt != null && message.activity.review?.files.length ? <TurnChangeSummary sessionId={session.id} messageId={message.id} review={message.activity.review} /> : null}
      {session.team?.messageId === message.id && !message.streaming ? <TeamPanel session={session} /> : null}
      {message.role === "agent" && (message.documents?.length || message.launched?.length) ? <AstroReplyExtras message={message} /> : null}
      {message.role === "agent" && message.content.trim() && !message.streaming ? <MessageActions message={message} session={session} /> : null}
    </article>
  );
}, sameRowProps);

/** The person's own text with its http(s) addresses as links, opened like those in replies. */
function LinkedText({ text }: { text: string }) {
  return <>{splitLinks(text).map((segment, index) => segment.kind === "text" ? segment.text
    : <a key={index} href={segment.url} className="chat-link break-all" onClick={(event) => { event.preventDefault(); openLink(segment.url, event.metaKey); }}>{segment.text}</a>)}</>;
}

/** The conversation's last reply finished with no text and no activity. */
function emptyReply(message: Message, session: Session): boolean {
  return message.role === "agent" && !message.streaming && !message.content.trim() && !(message.activity?.items.length)
    && message.activity?.status !== "stopped" && !["starting", "running", "waiting"].includes(session.status);
}

/** The agent stopped without answering: say so and offer to send the message again. */
function EmptyReplyNotice({ sessionId }: { sessionId: string }) {
  const t = useTranslation();
  const [busy, setBusy] = useState(false);
  return <div className="empty-reply" role="status">
    <span className="ui-caption text-text-muted">{t("session.emptyReply")}</span>
    <InteractiveButton variant="toolbar" loading={busy} onClick={() => {
      setBusy(true);
      void client.retryLastTurn(sessionId).catch((error: unknown) => useAppStore.setState({ error: formatUnknownError(error) })).finally(() => setBusy(false));
    }}><RotateCcw size={13} aria-hidden="true" />{t("session.sendAgain")}</InteractiveButton>
  </div>;
}
