import { CodeBlock } from "@/components/arc/code-block/code-block";

/** Finished code blocks in a streaming message keep their render (and their header motion). */
const TranscriptCodeBlock = memo(CodeBlock);
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { MessageActions, MessageTimestamp } from "@/components/MessageActions";
import { GitFork, Search } from "@/components/icons/phosphor";
import { IconButton } from "@/primitives/IconButton";
import { TranscriptSearchBar } from "@/components/TranscriptSearchBar";
import { SearchText } from "@/components/SearchText";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { StatusIndicator } from "@/primitives/StatusIndicator";
import { createTranscriptScroll } from "@/lib/transcript-scroll";
import { parseTranscript } from "@/lib/transcript";
import { isConversationStarted } from "@/lib/appearance";
import { cn } from "@/lib/cn";
import { motionTokens } from "@/lib/motion";
import { useTranslation } from "@/i18n/use-translation";
import { motion } from "motion/react";
import { Fragment, memo, useCallback, useDeferredValue, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { MessageTrail } from "@/components/MessageTrail";
import { TranscriptSelectionMenu } from "@/components/TranscriptSelectionMenu";
import { TurnChangeSummary } from "@/components/TurnChangeSummary";
import { TeamPanel } from "@/components/TeamPanel";
import { stripTeamPlan } from "@/lib/team";
import { hasConversation } from "@/lib/transcripts";
import { AgentActivity } from "@/components/AgentActivity";
import { AgentRequests } from "@/components/AgentRequests";
import { AgentComposer } from "@/components/AgentComposer";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { LandingControls } from "@/components/LandingControls";
import { LandingOrbits } from "@/components/LandingOrbits";
import { HandoffMarker } from "@/components/HandoffMarker";
import { ProviderSwitchScene } from "@/components/ProviderSwitchScene";
import { AstroBackdrop, AstroIcon } from "@/components/astros/AstroArt";
import { AstroHeader } from "@/components/astros/AstroHeader";
import { AstroCards } from "@/components/astros/AstroCard";
import type { ExecutionOptions, Message, Session } from "@/client/types";
import type { AgentInstall, AgentProviderId } from "@/client/types";
import { selectCurrentProject, selectCurrentSession, selectCurrentSessionMeta, useAppStore } from "@/store/app-store";

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
  const navigateMessage = useCallback((messageId: string) => {
    const node = messageNodes.current.get(messageId);
    if (!node) return;
    scrolling.current?.detach();
    node.scrollIntoView({ block: "start", behavior: "instant" });
    node.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    const viewport = transcript.current, content = transcriptContent.current, tail = latestTurn.current;
    if (!viewport || !content || !tail) return;
    const controller = createTranscriptScroll(viewport, content, tail, setFollowing);
    scrolling.current = controller;
    setFollowing(true);
    return () => { controller.dispose(); scrolling.current = null; };
  }, [session?.id, empty]);
  useLayoutEffect(() => { scrolling.current?.update(latestUserId); }, [latestUserId, session?.messages]);
  useLayoutEffect(() => {
    if (jump?.sessionId !== session?.id || !jump) return;
    const node = messageNodes.current.get(jump.messageId);
    if (!node) return;
    scrolling.current?.detach();
    const hit = jump.searchStart === undefined ? null : node.querySelector<HTMLElement>(`[data-search-start="${jump.searchStart}"]`);
    (hit ?? node).scrollIntoView({ block: "center", behavior: "instant" });
    node.focus({ preventScroll: true });
  }, [jump, session?.id]);
  const title = passive && !session ? t("split.newConversation") : project ? t("session.workOn", { project: project.name }) : t("session.workOnEmpty");

  return (
    <section className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col", !passive && !isConversationStarted(session) && "dot-grid")}>
      {empty && !passive && !astro ? <LandingOrbits /> : null}
      {astro ? <AstroBackdrop background={astro.background} color={astro.color} /> : null}
      {passive ? null : <ProviderSwitchScene owner={session?.id ?? "landing"} />}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        {astro && !passive ? <AstroHeader astro={astro} /> : null}
        {passive ? null : <TranscriptSearchBar sessionId={session?.id} />}
        {!empty && !search && !passive ? <div className="flex shrink-0 justify-end px-3"><IconButton label={t("search.current")} onClick={() => useAppStore.getState().openTranscriptSearch()}><Search size={14} /></IconButton></div> : null}
        {session?.lastError && !session.usageLimit ? <p role="alert" className="px-6 pt-3 ui-control text-danger">{t(session.lastError)}</p> : null}
        {session?.forkOrigin ? <div className="mx-auto flex w-full max-w-[var(--chat-column-width)] items-center gap-2 px-3 pt-2 ui-caption text-text-muted"><GitFork aria-hidden="true" size={13} /><span>{t("Fork of {title}", { title: session.forkOrigin.sourceTitle })}</span>{source ? <InteractiveButton variant="toolbar" className="ml-auto shrink-0" onClick={() => jumpToMessage(source.id, session.forkOrigin!.sourceMessageId)}>{t("View original")}</InteractiveButton> : <span>{t("Original session removed")}</span>}</div> : null}
        {empty ? (
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
                onScroll={() => scrolling.current?.scroll()}
                onWheel={() => scrolling.current?.interact()}
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
                <div ref={transcriptContent} className="mx-auto flex w-full shrink-0 max-w-[var(--chat-column-width)] flex-col gap-[var(--chat-message-gap)]">
                  {[messages.slice(0, Math.max(0, latestUserIndex)), messages.slice(Math.max(0, latestUserIndex))].map((group, groupIndex) => groupIndex === 0 && group.length === 0 ? null : <div key={groupIndex} ref={groupIndex === 1 ? latestTurn : undefined} className="flex shrink-0 flex-col gap-[var(--chat-message-gap)]" data-latest-turn={groupIndex === 1 || undefined}>
                  {group.map((message) => {
                    const change = providerChanges.get(message.id);
                    return <Fragment key={message.id}>
                      {change ? <HandoffMarker sessionId={session.id} from={change.from} to={change.to} live={message.streaming && !passive} /> : null}
                      <TranscriptMessage message={message} session={session} searchQuery={searchQuery} nodes={messageNodes} compacted={compactions.has(message.id)} />
                    </Fragment>;
                  })}
                  </div>)}
                </div>
              </motion.div>
              <MessageTrail key={`trail:${session.id}`}messages={messages} viewport={transcript} content={transcriptContent} nodes={messageNodes} onSelect={navigateMessage} />
              {passive ? null : <TranscriptSelectionMenu key={`selection:${session.id}`} sessionId={session.id} viewport={transcript} />}
          </div>

        )}
        {!empty && !following ? <button type="button" className="absolute bottom-40 left-1/2 z-20 -translate-x-1/2 rounded-[7px] bg-background-2 px-3 py-1 ui-control text-text-secondary hover:bg-background-3" onClick={() => {
          scrolling.current?.follow();
        }}>{t("session.followLatest")}</button> : null}
        {sessionMeta && !passive ? <AgentRequests session={sessionMeta} /> : null}
        {empty && project && !passive && !astro && !session?.handoff?.pending ? <LandingControls /> : null}
        <div className="relative z-10 px-6 pb-4">
          {passive ? <PassiveComposer session={session} /> : <AgentComposer session={sessionMeta} agents={agents} onSend={onSend} onStop={onStop} onModelChange={onModelChange} />}
        </div>
      </div>
    </section>
  );
}

/** Stands in for the composer of an inactive pane; using it activates the pane (see SplitWorkspace). */
function PassiveComposer({ session }: { session: Session | null }) {
  const t = useTranslation();
  return <button type="button" className="split-passive-composer ui-body">
    <span className="truncate text-text-muted">{t(session?.status === "waiting" ? "split.waiting" : "split.reply")}</span>
    {session && ["starting", "running", "waiting"].includes(session.status) ? <span className="ml-auto shrink-0"><StatusIndicator status={session.status} /></span> : null}
  </button>;
}

/** Session fields a message row reads besides its own message. */
function sameRowSession(a: Session, b: Session) {
  return a.id === b.id && a.status === b.status && a.agent === b.agent && a.model === b.model && a.pinnedMessageIds === b.pinnedMessageIds && a.team === b.team;
}

/**
 * One transcript row. Memoized so a streamed chunk re-renders only the message
 * it changed, not every earlier message and its parsed code blocks.
 */
const TranscriptMessage = memo(function TranscriptMessage({ message, session, searchQuery, nodes, compacted = false }: {
  message: Message;
  session: Session;
  searchQuery: string;
  nodes: RefObject<Map<string, HTMLElement>>;
  compacted?: boolean;
}) {
  const t = useTranslation();
  const register = useCallback((node: HTMLElement | null) => {
    if (node) nodes.current.set(message.id, node); else nodes.current.delete(message.id);
  }, [nodes, message.id]);
  // A reply is cut where the person steered it, so each instruction shows where it arrived.
  const segments = useMemo(() => {
    if (message.role !== "agent" || !message.content) return null;
    const team = session.team?.messageId === message.id;
    const content = team ? stripTeamPlan(message.content) : message.content;
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
  }, [message.role, message.content, message.id, message.steers, session.team?.messageId]);
  return (
    <article data-message-id={message.id} ref={register} tabIndex={-1} className={`selectable min-w-0 rounded-[7px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${message.role === "user" ? "group/user flex max-w-[85%] flex-col items-end self-end" : "w-full self-start"}`}>
      <p className="sr-only">
        {t(message.role === "user" ? "You" : "Agent")}
      </p>
      {message.role === "agent" && message.activity ? <AgentActivity activity={message.activity} /> : null}
      <div
        data-transcript-text
        className={`min-w-0 max-w-full whitespace-pre-wrap ui-chat [overflow-wrap:anywhere] ${
          message.role === "user" ? "rounded-[18px] bg-[var(--chat-bubble)] px-4 py-2.5 text-text-primary" : "text-text-secondary"
        }`}
      >
        {message.content ? (message.role === "agent" ? (segments ?? []).map((segment, part) => {
          let offset = segment.start;
          return <Fragment key={part}>
            {segment.blocks.map((block, index) => {
              const start = offset;
              offset += block.content.length + 1;
              if (block.kind === "code" && block.language.toLowerCase() === "sirus-card" && session.astro && !message.streaming && !searchQuery.trim()) return <AstroCards key={index} source={block.content} session={session} settled={!message.streaming} />;
              if (block.kind === "code" && block.language.toLowerCase() === "mermaid" && !message.streaming && !searchQuery.trim()) return <div className="my-3" key={index}><MermaidDiagram source={block.content} /></div>;
              if (block.kind === "code") return <div className="my-3" key={index}><TranscriptCodeBlock code={block.content} language={block.language} maxLines={searchQuery.trim() ? undefined : 18} animateChanges={false} searchQuery={searchQuery} searchOffset={start} /></div>;
              // Search highlights need the raw text offsets, so a search shows the reply unformatted.
              return searchQuery.trim() ? <p key={index} className="whitespace-pre-wrap"><SearchText text={block.content} query={searchQuery} offset={start} /></p> : <ChatMarkdown key={index} text={block.content} sessionId={session.id} cwd={session.worktree.path} />;
            })}
            {segment.steer !== undefined ? <div className="my-3 flex justify-end"><div className="max-w-[85%] rounded-[18px] bg-[var(--chat-bubble)] px-4 py-2.5 text-text-primary"><span className="mb-0.5 block ui-caption text-text-muted">{t("steer.label")}</span>{segment.steer}</div></div> : null}
          </Fragment>;
        }) : <SearchText text={message.content} query={searchQuery} />) : compacted && !message.streaming ? <span className="text-text-muted">✓ {t("context.compacted")}</span> : (message.activity ? null : message.streaming ? "…" : t("session.noOutput"))}
      </div>
      {message.role === "user" && message.content && !message.streaming ? <div className="pointer-events-none mt-1 flex min-h-6 items-center justify-end gap-1.5 px-2 text-text-muted opacity-0 group-hover/user:pointer-events-auto group-hover/user:opacity-100 group-focus-within/user:pointer-events-auto group-focus-within/user:opacity-100 motion-safe:transition-opacity motion-safe:duration-[var(--motion-fast)] [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
        <CopyButton value={message.content} label={t("Copy message")} iconOnly variant="plain" className="size-6 min-h-0 text-text-muted [&_svg]:size-[13px]" />
        <MessageTimestamp createdAt={message.createdAt} />
      </div> : null}
      {message.role === "agent" && !message.streaming && message.activity?.endedAt != null && message.activity.review ? <TurnChangeSummary sessionId={session.id} messageId={message.id} review={message.activity.review} /> : null}
      {session.team?.messageId === message.id && !message.streaming ? <TeamPanel session={session} /> : null}
      {message.role === "agent" && message.content.trim() && !message.streaming ? <MessageActions message={message} session={session} /> : null}
    </article>
  );
}, (previous, next) => previous.message === next.message && previous.compacted === next.compacted && previous.searchQuery === next.searchQuery && previous.nodes === next.nodes && sameRowSession(previous.session, next.session));
