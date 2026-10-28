import { ParentBreadcrumb } from "@/components/ParentBreadcrumb";
import { CodeBlock } from "@/components/arc/code-block/code-block";

/** Finished code blocks in a streaming message keep their render (and their header motion). */
const TranscriptCodeBlock = memo(CodeBlock);
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { MessageActions, MessageTimestamp } from "@/components/MessageActions";
import { ChevronDown, GitFork, RotateCcw, TerminalSquare } from "@/components/icons";
import { formatUnknownError } from "@/lib/format-error";
import { isCompactCommand } from "@/lib/compact-before-send";
import "@/styles/context-meter.css";
import { TranscriptSearchBar } from "@/components/TranscriptSearchBar";
import { SearchText } from "@/components/SearchText";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { StatusIndicator } from "@/primitives/StatusIndicator";
import { createTranscriptScroll, messageSizeStyle, scrollWithin, upwardIntent } from "@/lib/transcript-scroll";
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
import { SessionMovedNote } from "@/components/MoveSessionDialog";
import { TranscriptSelectionMenu } from "@/components/TranscriptSelectionMenu";
import { TurnChangeSummary } from "@/components/TurnChangeSummary";
import { TeamPanel } from "@/components/TeamPanel";
import { stripTeamPlan } from "@/lib/team";
import { hasConversation } from "@/lib/transcripts";
import { useSmoothText } from "@/lib/use-smooth-text";
import { visibleReplyText } from "@/lib/response-streaming";
import { useStreamFade } from "@/lib/use-stream-fade";
import { splitPromptContext } from "@/lib/prompt-context";
import { smallThumbnailUrl, thumbnailUrl } from "@/lib/thumbnail-url";
import { PlanActions, QUICK_REPLY_EVENT, ReplyChoices, type QuickReplyDetail } from "@/components/ReplyChoices";
import { BackgroundTasks } from "@/components/BackgroundTasks";
import { ImageLightbox } from "@/components/ImageLightbox";
import { ReplyExtras } from "@/components/ReplyExtras";
import { FileTypeIcon, fileKind, formatFileSize } from "@/components/FileTypeIcon";
import { HtmlPreview } from "@/components/HtmlPreview";
import { InlineVisuals } from "@/components/InlineVisual";
import { composerSegments, hasComposerTokens } from "@/lib/composer-tokens";
import { AgentActivity } from "@/components/AgentActivity";
import { SubagentTeam } from "@/components/SubagentTeam";
import { firstLaunchOffset, teamSize } from "@/lib/subagent-team";
import { AgentRequests } from "@/components/AgentRequests";
import { AgentComposer } from "@/components/AgentComposer";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { ChatLink } from "@/components/ChatLink";
import { WORKING_PANEL_MIN_WIDTH, WORKING_PANEL_WIDTH, WorkingPanel } from "@/components/WorkingPanel";
import { splitLinks } from "@/lib/link-text";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { LandingControls } from "@/components/LandingControls";
import { ComputerTray } from "@/components/ComputerSwitcher";
import { HandoffMarker } from "@/components/HandoffMarker";
import { ProviderSwitchScene } from "@/components/ProviderSwitchScene";
import type { ExecutionOptions, Message, MessageAttachment, Session } from "@/client/types";
import { client } from "@/client";
import { isFreshMessage } from "@/lib/fresh-message";
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
  const touchY = useRef<number | null>(null);
  const messages = useMemo(() => session?.messages.filter(message => message.role !== "system") ?? [], [session?.messages]);
  // Replies to a standalone `/compact` read as a compaction, not as an empty answer (ADR-057).
  const compactions = useMemo(() => new Set(messages.filter((message, index) => message.role === "agent" && messages[index - 1]?.role === "user" && isCompactCommand(messages[index - 1].content)).map((message) => message.id)), [messages]);
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
  // Only the last turns are mounted: the latest few on first paint, then
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
    // A press can end outside the transcript (a selection dragged past its edge).
    const release = () => controller.hold(false);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    return () => {
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      controller.dispose();
      scrolling.current = null;
    };
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

  const landing = empty && !passive;
  return (
    <section className={cn("session-pane relative flex min-h-0 min-w-0 flex-1 flex-col", !passive && !isConversationStarted(session) && "dot-grid")} data-empty={!isConversationStarted(session) || undefined}>
      {passive ? null : <ProviderSwitchScene owner={session?.id ?? "landing"} />}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        {passive ? null : <TranscriptSearchBar sessionId={session?.id} />}
        {session?.lastError && !session.usageLimit ? <p role="alert" className="px-6 pt-3 ui-control text-danger">{t(session.lastError)}</p> : null}
        {session && !passive ? <ParentBreadcrumb session={session} /> : null}
        {session?.forkOrigin ? <div className="mx-auto flex w-full max-w-[var(--chat-column-width)] items-center gap-2 px-3 pt-2 ui-caption text-text-muted"><GitFork aria-hidden="true" size={13} /><span>{t("Fork of {title}", { title: session.forkOrigin.sourceTitle })}</span>{source ? <InteractiveButton variant="toolbar" className="ml-auto shrink-0" onClick={() => jumpToMessage(source.id, session.forkOrigin!.sourceMessageId)}>{t("View original")}</InteractiveButton> : <span>{t("Original session removed")}</span>}</div> : null}
        {/* A new thread: the question sits left-aligned over the composer, both a little above the middle. */}
        {landing ? <div className="flex min-h-0 flex-1 flex-col justify-end">
          <div className="px-6 pb-3"><div className="mx-auto w-full max-w-[var(--chat-column-width)] pl-3">
            <h2 className="ui-title text-left text-text-primary">{title}</h2>
            {!project ? <button type="button" onClick={() => void openProject()} className="mt-2 ui-body text-accent">{t("project.open")}</button> : null}
          </div></div>
        </div> : empty ? (
          <div className="relative flex min-h-0 flex-1 flex-col items-center overflow-hidden px-8">
            <div className="relative z-10 flex flex-1 flex-col items-center justify-center">
              <img data-landing-glyph={passive ? undefined : ""} src="/sirus-glyph.png" alt="" draggable={false} className={cn("mb-4 w-auto opacity-95", passive ? "h-[36px]" : "h-[54px]")} />
              <h2 className="ui-title text-text-primary">{title}</h2>
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
                // Every manual gesture up releases following at once; nested
                // content that scrolls on its own keeps the gesture to itself.
                onWheel={(event) => scrolling.current?.interact(upwardIntent(event.currentTarget, event.target, { kind: "wheel", deltaY: event.deltaY }))}
                onTouchStart={(event) => { touchY.current = event.touches[0]?.clientY ?? null; }}
                onTouchMove={(event) => {
                  const y = event.touches[0]?.clientY, start = touchY.current;
                  touchY.current = y ?? null;
                  // A finger moving down drags the content down: reading up.
                  scrolling.current?.interact(y === undefined || start === null ? undefined : upwardIntent(event.currentTarget, event.target, { kind: "touch", deltaY: start - y }));
                }}
                onPointerDown={(event) => {
                  scrolling.current?.hold(true);
                  scrolling.current?.interact(upwardIntent(event.currentTarget, event.target, { kind: "pointer", clientX: event.clientX }));
                }}
                onKeyDown={(event) => scrolling.current?.interact(upwardIntent(event.currentTarget, event.target, { kind: "key", key: event.key }))}
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
                <SessionMovedNote session={session} which="from" />
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
                <SessionMovedNote session={session} which="to" />
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
        {empty && project && !passive && !session?.handoff?.pending ? <LandingControls /> : null}
        {!empty && !passive ? <ComputerTray /> : null}
        <div className="relative z-10 px-6 pb-4">
          {passive || !session ? null : <ReplyChoices session={session} message={messages[messages.length - 1]} />}
          {passive || !session ? null : <BackgroundTasks session={session} message={messages[messages.length - 1]} />}
          {passive ? <PassiveComposer session={session} /> : <AgentComposer session={sessionMeta} agents={agents} onSend={onSend} onStop={onStop} onModelChange={onModelChange} />}
          {/* The Working panel floats at the bottom-right, in the room beside the composer; it never moves it (ADR-094). */}
          {passive ? null : <WorkingDock />}
        </div>
        {landing ? <div className="flex-[1.15]" aria-hidden="true" /> : null}
      </div>
    </section>
  );
}

const WORKING_COLLAPSED_KEY = "sirus.workingPanel.collapsed";

/**
 * Places the Working panel in the free space right of the centred composer, and hides it when that
 * space is too narrow. It sits at the pane's bottom even when the composer is raised to the middle
 * (a new conversation's landing). Collapsed, it is a thin tab on the pane's right edge, which
 * always fits; the choice is remembered.
 */
function WorkingDock() {
  const node = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  const [drop, setDrop] = useState(0);
  const [collapsed, setCollapsed] = useState(() => globalThis.localStorage?.getItem(WORKING_COLLAPSED_KEY) === "1");
  const toggle = () => setCollapsed((value) => {
    globalThis.localStorage?.setItem(WORKING_COLLAPSED_KEY, value ? "0" : "1");
    return !value;
  });
  useLayoutEffect(() => {
    const dock = node.current;
    const row = dock?.parentElement;
    const pane = row?.parentElement;
    const composer = row?.querySelector<HTMLElement>(".agent-composer");
    if (!row || !pane || !composer) return;
    const measure = () => {
      const rowBox = row.getBoundingClientRect();
      // Space between the composer and the row's padding edge, less a gap.
      setRoom(Math.floor(rowBox.right - composer.getBoundingClientRect().right - 24 - 16));
      setDrop(Math.max(0, Math.floor(pane.getBoundingClientRect().bottom - rowBox.bottom)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    observer.observe(pane);
    observer.observe(composer);
    return () => observer.disconnect();
  }, []);
  const fits = room >= WORKING_PANEL_MIN_WIDTH;
  const transform = drop ? `translateY(${drop}px)` : undefined;
  return <div ref={node} className={collapsed ? "absolute bottom-4 right-0" : "absolute bottom-4 right-6"}
    style={collapsed ? { transform } : fits ? { width: Math.min(room, WORKING_PANEL_WIDTH), transform } : { display: "none" }}>
    <WorkingPanel collapsed={collapsed} onToggle={toggle} />
  </div>;
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
  // A message just sent (or a reply just started) rises in once; history never animates.
  const [fresh] = useState(() => isFreshMessage(message.createdAt));
  const register = useCallback((node: HTMLElement | null) => {
    if (node) nodes.current.set(message.id, node); else nodes.current.delete(message.id);
  }, [nodes, message.id]);
  // A reply is cut where the person steered it, so each instruction shows where it arrived.
  // A streaming reply comes out at a steady pace rather than in the provider's bursts.
  // Settings → Response streaming (ADR-130): the whole reply after the turn, finished
  // paragraphs, or every word (the steady pace and fade below apply only to that last one).
  const streamingMode = useAppStore((state) => state.settings.responseStreaming);
  const live = message.role === "agent" && Boolean(message.streaming);
  const streamedContent = useMemo(() => visibleReplyText(message.content, streamingMode, live), [message.content, streamingMode, live]);
  const shownContent = useSmoothText(streamedContent, live && streamingMode === "token");
  // Its newest words fade in, at a length set by how fast the provider's chunks arrive (ADR-119).
  const fade = useStreamFade(message.content, live && streamingMode === "token");
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
  // Images show as thumbnails on top; other files and older messages as chips.
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
  // A turn that started two subagents or more opens with its team card (ADR-146), headed by the prompt that asked for it.
  const teamPrompt = useMemo(() => {
    if (message.role !== "agent" || !message.activity || teamSize(message.activity.items) < 2) return null;
    for (let at = session.messages.findIndex((entry) => entry.id === message.id) - 1; at >= 0; at -= 1) {
      if (session.messages[at].role === "user") return splitPromptContext(session.messages[at].content).request;
    }
    return "";
  }, [message.role, message.activity, message.id, session.messages]);
  const teamOffset = teamPrompt !== null && message.activity ? firstLaunchOffset(message.activity.items) : undefined;
  const teamReplyHead = useMemo(() => teamPrompt === null ? "" : replyContent.slice(0, teamOffset ?? replyContent.length), [teamPrompt, replyContent, teamOffset]);
  /** Reply blocks from `base` in the reply, so search highlights keep their offsets.
   * `tail`: these blocks end the reply, so the last one fades its newest words while streaming. */
  const renderBlocks = (blocks: ReturnType<typeof parseTranscript>, base: number, tail = false) => {
    let offset = base;
    return blocks.map((block, index) => {
      const blockFade = tail && index === blocks.length - 1 ? fade : null;
      const start = offset;
      offset += block.content.length + 1;
      if (block.kind === "code" && block.language.toLowerCase() === "html" && !message.streaming && !searchQuery.trim()) return <div className="my-3" key={index}><HtmlPreview source={block.content} /></div>;
      if (block.kind === "code" && block.language.toLowerCase() === "mermaid" && !message.streaming && !searchQuery.trim()) return <div className="my-3" key={index}><MermaidDiagram source={block.content} /></div>;
      if (block.kind === "code") return <div className="my-3" key={index}><TranscriptCodeBlock code={block.content} language={block.language} maxLines={searchQuery.trim() ? undefined : 18} animateChanges={false} searchQuery={searchQuery} searchOffset={start} /></div>;
      // Search highlights need the raw text offsets, so a search shows the reply unformatted.
      return searchQuery.trim() ? <p key={index} className="whitespace-pre-wrap"><SearchText text={block.content} query={searchQuery} offset={start} /></p> : <ChatMarkdown key={index} text={block.content} sessionId={session.id} cwd={session.worktree.path} fade={blockFade} />;
    });
  };
  return (
    <article data-message-id={message.id} data-fresh={fresh ? message.role : undefined} ref={register} tabIndex={-1} style={messageSizeStyle(message)} className={`selectable min-w-0 rounded-[7px] outline-none ${message.role === "user" ? "group/user flex max-w-[80%] flex-col items-end self-end" : "group/agent w-full self-start"}`}>
      <p className="sr-only">
        {t(message.role === "user" ? "You" : "Agent")}
      </p>
      {teamPrompt !== null && message.activity ? <SubagentTeam items={message.activity.items} provider={message.activity.provider} sessionId={session.id} messageId={message.id} prompt={teamPrompt} replyHead={teamReplyHead} /> : null}
      <div
        data-transcript-text
        className={`min-w-0 max-w-full whitespace-pre-wrap ui-chat [overflow-wrap:anywhere] ${
          message.role === "user" ? "user-bubble bg-[var(--chat-bubble)] text-text-primary" : "text-text-secondary"
        }`}
      >
        {message.role === "agent" && message.activity ? <AgentActivity activity={message.activity} message={message} content={replyContent} steers={replySteers} cwd={session.worktree.path}
          subagentControls={session.agent === "claude" && message.streaming ? session.id : undefined}
          onResume={last ? (text) => window.dispatchEvent(new CustomEvent<QuickReplyDetail>(QUICK_REPLY_EVENT, { detail: { sessionId: session.id, text } })) : undefined}
          renderText={(start, end) => renderBlocks(parseCached(replyContent.slice(start, end)), start, end >= replyContent.length)}
          renderSteer={(text) => <div className="my-3 flex justify-end"><div className="user-bubble max-w-[80%] bg-[var(--chat-bubble)] text-text-primary"><span className="mb-0.5 block ui-caption text-text-muted">{t("steer.label")}</span>{text}</div></div>} />
        : (message.role === "agent" ? shownContent : message.content) ? (message.role === "agent" ? (segments ?? []).map((segment, part) => {
          const offset = segment.start;
          return <Fragment key={part}>
            {renderBlocks(segment.blocks, offset, part === (segments ?? []).length - 1)}
            {segment.steer !== undefined ? <div className="my-3 flex justify-end"><div className="user-bubble max-w-[80%] bg-[var(--chat-bubble)] text-text-primary"><span className="mb-0.5 block ui-caption text-text-muted">{t("steer.label")}</span>{segment.steer}</div></div> : null}
          </Fragment>;
        }) : <>
          {userImages.length ? <span className="prompt-thumbnails">{userImages.map((file, index) => <button key={index} type="button" className="prompt-thumbnail-button" aria-label={file.name} title={file.name} onClick={() => setOpenImage(index)}><img src={file.small} alt="" decoding="async" loading="lazy" className="prompt-thumbnail" draggable={false} /></button>)}</span> : null}
          {/* Files sit on top of the text, like the thumbnails; a sent file opens in the attachment viewer. */}
          {userFiles.length ? <span className="prompt-references prompt-references-top">{userFiles.map((reference, index) => {
            if (reference.kind === "terminal") return <span key={index} className="prompt-reference ui-caption"><TerminalSquare size={13} aria-hidden="true" /><span className="truncate">{reference.name}</span></span>;
            const chip = <>
              <FileTypeIcon kind={fileKind(reference.name, reference.kind, reference.mimeType)} size={18} />
              <span className="attachment-chip-name">{reference.name}</span>
              {reference.size !== undefined ? <span className="attachment-chip-size">{formatFileSize(reference.size)}</span> : null}
            </>;
            const sent = "id" in reference && reference.id && reference.kind === "file" ? reference as MessageAttachment : null;
            return sent
              ? <span key={index} className="attachment-chip attachment-chip-static" title={reference.name}><button type="button" className="attachment-chip-open" onClick={() => void useAppStore.getState().openSentAttachment([`session:${session.id}`, `project:${session.projectId}`], sent).then((failure) => { if (failure) useAppStore.setState({ error: t(failure) }); })}>{chip}</button></span>
              : <span key={index} className="attachment-chip attachment-chip-static" title={reference.name}><span className="attachment-chip-open">{chip}</span></span>;
          })}</span> : null}
          {searchQuery.trim() ? <SearchText text={userRequest} query={searchQuery} />
            : hasComposerTokens(userRequest) ? composerSegments(userRequest).map((segment, index) => segment.kind === "text" ? <LinkedText key={index} text={segment.text} /> : <span key={index} className={`composer-token composer-token-${segment.kind}`}>{segment.text}</span>)
            : <LinkedText text={userRequest} />}
        </>) : compacted && message.streaming ? <span className="text-text-muted">{t("context.compacting")}</span>
          // A compaction that failed or was stopped says so in the session's error, not here.
          : compacted && !(last && (session.status === "failed" || session.status === "stopped")) ? <span className="text-text-muted">✓ {t("context.compacted")}</span>
          : (message.activity ? null : message.streaming ? "…" : t("session.noOutput"))}
      </div>
      {userImages.length ? <ImageLightbox images={openImage === null ? null : gallery} index={openImage ?? 0} onClose={() => setOpenImage(null)} /> : null}
      {message.role === "user" && message.content && !message.streaming ? <div className="pointer-events-none mt-1 flex min-h-6 items-center justify-end gap-1.5 px-2 text-text-muted opacity-0 group-hover/user:pointer-events-auto group-hover/user:opacity-100 group-focus-within/user:pointer-events-auto group-focus-within/user:opacity-100 motion-safe:transition-opacity motion-safe:duration-[var(--motion-fast)] [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
        <CopyButton value={userRequest} label={t("Copy message")} iconOnly variant="plain" className="size-6 min-h-0 text-text-muted [&_svg]:size-[13px]" />
        <MessageTimestamp createdAt={message.createdAt} />
      </div> : null}
      {message.role === "agent" && !message.streaming && message.activity?.endedAt != null && message.activity.review?.files.length ? <TurnChangeSummary sessionId={session.id} messageId={message.id} review={message.activity.review} /> : null}
      {session.team?.messageId === message.id && !message.streaming ? <TeamPanel session={session} /> : null}
      {message.role === "agent" && message.visuals?.length ? <InlineVisuals visuals={message.visuals} /> : null}
      {message.role === "agent" && message.launched?.length ? <ReplyExtras message={message} /> : null}
      {message.role === "agent" && message.content.trim() && !message.streaming ? <MessageActions message={message} session={session} /> : null}
    </article>
  );
}, sameRowProps);

/** The person's own text with its web addresses as link chips, opened like those in replies (ADR-149). */
function LinkedText({ text }: { text: string }) {
  return <>{splitLinks(text).map((segment, index) => segment.kind === "text" ? segment.text : <ChatLink key={index} url={segment.url} chip />)}</>;
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
