import { CodeBlock } from "@/components/arc/code-block/code-block";
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { MessageActions, MessageTimestamp } from "@/components/MessageActions";
import { GitFork, Search } from "lucide-react";
import { IconButton } from "@/primitives/IconButton";
import { TranscriptSearchBar } from "@/components/TranscriptSearchBar";
import { SearchText } from "@/components/SearchText";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { createTranscriptScroll } from "@/lib/transcript-scroll";
import { parseTranscript } from "@/lib/transcript";
import { isConversationStarted } from "@/lib/appearance";
import { cn } from "@/lib/cn";
import { motionTokens } from "@/lib/motion";
import { useTranslation } from "@/i18n/use-translation";
import { motion } from "motion/react";
import { useCallback, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MessageTrail } from "@/components/MessageTrail";
import { TranscriptSelectionMenu } from "@/components/TranscriptSelectionMenu";
import { TurnChangeSummary } from "@/components/TurnChangeSummary";
import { TeamPanel } from "@/components/TeamPanel";
import { stripTeamPlan } from "@/lib/team";
import { AgentActivity } from "@/components/AgentActivity";
import { AgentRequests } from "@/components/AgentRequests";
import { AgentComposer } from "@/components/AgentComposer";
import { UsageFooter } from "@/components/UsageFooter";
import { LandingControls } from "@/components/LandingControls";
import { LandingOrbits } from "@/components/LandingOrbits";
import type { ExecutionOptions, Session } from "@/client/types";
import type { AgentInstall, AgentProviderId } from "@/client/types";
import { selectCurrentProject, useAppStore } from "@/store/app-store";

interface Props {
  session: Session | null;
  agents: AgentInstall[];
  onSend: (prompt: string, execution?: ExecutionOptions) => Promise<boolean>;
  onStop: () => void;
  onNewSession: () => void;
  onModelChange?: (provider: AgentProviderId, model: string | null) => void;
}

export function SessionPane({ session, agents, onSend, onStop, onModelChange }: Props) {
  const t = useTranslation();
  const openProject = useAppStore((state) => state.addProjectFromPicker);
  const project = useAppStore(selectCurrentProject);
  const jump = useAppStore((state) => state.messageJump);
  const jumpToMessage = useAppStore((state) => state.jumpToMessage);
  const search = useAppStore(state => state.transcriptSearch);
  const searchQuery = useDeferredValue(search?.query ?? "");
  const source = useAppStore((state) => state.sessions.find((item) => item.id === session?.forkOrigin?.sourceSessionId));
  const empty = !session || !session.messages.some((message) => message.role !== "system");
  const transcript = useRef<HTMLDivElement>(null);
  const messageNodes = useRef(new Map<string, HTMLElement>());
  const transcriptContent = useRef<HTMLDivElement>(null);
  const latestTurn = useRef<HTMLDivElement>(null);
  const scrolling = useRef<ReturnType<typeof createTranscriptScroll> | null>(null);
  const messages = useMemo(() => session?.messages.filter(message => message.role !== "system") ?? [], [session?.messages]);
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
  const title = project ? t("session.workOn", { project: project.name }) : t("session.workOnEmpty");

  return (
    <section className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col", !isConversationStarted(session) && "dot-grid")}>
      {empty ? <LandingOrbits /> : null}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <TranscriptSearchBar sessionId={session?.id} />
        {!empty && !search ? <div className="flex shrink-0 justify-end px-3"><IconButton label={t("search.current")} onClick={() => useAppStore.getState().openTranscriptSearch()}><Search size={14} /></IconButton></div> : null}
        {session?.lastError ? <p role="alert" className="px-6 pt-3 ui-control text-danger">{t(session.lastError)}</p> : null}
        {session?.forkOrigin ? <div className="mx-auto flex w-full max-w-[var(--chat-column-width)] items-center gap-2 px-3 pt-2 ui-caption text-text-muted"><GitFork aria-hidden="true" size={13} /><span>{t("Fork of {title}", { title: session.forkOrigin.sourceTitle })}</span>{source ? <InteractiveButton variant="toolbar" className="ml-auto shrink-0" onClick={() => jumpToMessage(source.id, session.forkOrigin!.sourceMessageId)}>{t("View original")}</InteractiveButton> : <span>{t("Original session removed")}</span>}</div> : null}
        {empty ? (
          <div className="relative flex min-h-0 flex-1 flex-col items-center overflow-hidden px-8">
            <div className="relative z-10 flex flex-1 flex-col items-center justify-center">
              <img data-landing-glyph src="/switchyard-glyph.png" alt="" draggable={false} className="mb-4 h-[54px] w-auto opacity-95" />
              <h2 className="ui-title text-text-primary">{title}</h2>
              {!project ? <button type="button" onClick={() => void openProject()} className="mt-4 ui-body text-accent">{t("project.open")}</button> : null}
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
                className="transcript-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-6"
              >
                <div ref={transcriptContent} className="mx-auto flex w-full shrink-0 max-w-[var(--chat-column-width)] flex-col gap-[var(--chat-message-gap)]">
                  {[messages.slice(0, Math.max(0, latestUserIndex)), messages.slice(Math.max(0, latestUserIndex))].map((group, groupIndex) => groupIndex === 0 && group.length === 0 ? null : <div key={groupIndex} ref={groupIndex === 1 ? latestTurn : undefined} className="flex shrink-0 flex-col gap-[var(--chat-message-gap)]" data-latest-turn={groupIndex === 1 || undefined}>
                  {group.map((message) => (
                    <article key={message.id} data-message-id={message.id} ref={(node) => { if (node) messageNodes.current.set(message.id, node); else messageNodes.current.delete(message.id); }} tabIndex={-1} className={`selectable min-w-0 rounded-[7px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${message.role === "user" ? "group/user flex max-w-[85%] flex-col items-end self-end" : "w-full self-start"}`}>
                      <p className="sr-only">
                        {t(message.role === "user" ? "You" : "Agent")}
                      </p>
                      {message.role === "agent" && message.activity ? <AgentActivity activity={message.activity} /> : null}
                      <div
                        data-transcript-text
                        className={`min-w-0 max-w-full whitespace-pre-wrap ui-chat [overflow-wrap:anywhere] ${
                          message.role === "user" ? "rounded-[18px] bg-background-3 px-4 py-2.5 text-text-primary" : "text-text-secondary"
                        }`}
                      >
                        {message.content ? (message.role === "agent" ? (() => {
                          let offset = 0;
                          return parseTranscript(session.team?.messageId === message.id ? stripTeamPlan(message.content) : message.content).map((block, index) => {
                            const start = offset;
                            offset += block.content.length + 1;
                            return block.kind === "code" ? <div className="my-3" key={index}><CodeBlock code={block.content} language={block.language} maxLines={searchQuery.trim() ? undefined : 18} animateChanges={false} searchQuery={searchQuery} searchOffset={start} /></div> : <p key={index} className="whitespace-pre-wrap"><SearchText text={block.content} query={searchQuery} offset={start} /></p>;
                          });
                        })() : <SearchText text={message.content} query={searchQuery} />) : (message.activity ? null : message.streaming ? "…" : t("session.noOutput"))}
                      </div>
                      {message.role === "user" && message.content && !message.streaming ? <div className="pointer-events-none mt-1 flex min-h-6 items-center justify-end gap-1.5 px-2 text-text-muted opacity-0 group-hover/user:pointer-events-auto group-hover/user:opacity-100 group-focus-within/user:pointer-events-auto group-focus-within/user:opacity-100 motion-safe:transition-opacity motion-safe:duration-[var(--motion-fast)] [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
                        <CopyButton value={message.content} label={t("Copy message")} iconOnly variant="plain" className="size-6 min-h-0 text-text-muted [&_svg]:size-[13px]" />
                        <MessageTimestamp createdAt={message.createdAt} />
                      </div> : null}
                      {message.role === "agent" && !message.streaming && message.activity?.endedAt != null && message.activity.review ? <TurnChangeSummary sessionId={session.id} messageId={message.id} review={message.activity.review} /> : null}
                      {session.team?.messageId === message.id && !message.streaming ? <TeamPanel session={session} /> : null}
                      {message.role === "agent" && message.content.trim() && !message.streaming ? <MessageActions message={message} session={session} /> : null}
                    </article>
                  ))}
                  </div>)}
                </div>
              </motion.div>
              <MessageTrail key={`trail:${session.id}`}messages={messages} viewport={transcript} content={transcriptContent} nodes={messageNodes} onSelect={navigateMessage} />
              <TranscriptSelectionMenu key={`selection:${session.id}`} sessionId={session.id} viewport={transcript} />
          </div>

        )}
        {!empty && !following ? <button type="button" className="absolute bottom-40 left-1/2 z-20 -translate-x-1/2 rounded-[7px] bg-background-2 px-3 py-1 ui-control text-text-secondary hover:bg-background-3" onClick={() => {
          scrolling.current?.follow();
        }}>{t("session.followLatest")}</button> : null}
        {session ? <AgentRequests session={session} /> : null}
        {empty && project && !session?.handoff?.pending ? <LandingControls /> : null}
        <div className="relative z-10 px-6 pb-2">
          <AgentComposer session={session} agents={agents} onSend={onSend} onStop={onStop} onModelChange={onModelChange} />
        </div>
        <div className="relative z-10 shrink-0 px-6"><UsageFooter composerAligned /></div>
      </div>
    </section>
  );
}
