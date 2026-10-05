import { memo, useLayoutEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { CornerUpLeft } from "@/components/icons/phosphor";
import type { Message } from "@/client/types";
import { CodeBlock } from "@/components/arc/code-block/code-block";
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { AgentActivity } from "@/components/AgentActivity";
import { AgentComposer } from "@/components/AgentComposer";
import { AgentRequests } from "@/components/AgentRequests";
import { useTranslation } from "@/i18n/use-translation";
import { parseTranscript } from "@/lib/transcript";
import { appendTranscriptQuote } from "@/lib/transcript-selection";
import { useRetainedTranscripts } from "@/lib/use-retained-transcripts";
import { Tooltip } from "@/primitives/Tooltip";
import { useAppStore } from "@/store/app-store";

const SideCodeBlock = memo(CodeBlock);

/**
 * A side chat beside its main session (ADR-049): same workspace and provider,
 * a fresh recap of the main session on every turn, and nothing sent back to
 * the main session unless the person takes an answer there.
 */
export function SideChatPane({ parentSessionId, paneId }: { parentSessionId: string; paneId: string }) {
  const t = useTranslation();
  const agents = useAppStore((state) => state.agents);
  const side = useAppStore((state) => state.sessions.find((session) => session.sideChat?.parentSessionId === parentSessionId) ?? null);
  const sendPrompt = useAppStore((state) => state.sendPrompt);
  const stopAgent = useAppStore((state) => state.stopAgent);
  const setSessionModel = useAppStore((state) => state.setSessionModel);
  useRetainedTranscripts([side?.id]);
  const scroller = useRef<HTMLDivElement>(null);
  const messages = useMemo(() => side?.messages.filter((message) => message.role !== "system") ?? [], [side?.messages]);

  // Follow new output while the reader is at the end.
  const atEnd = useRef(true);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && atEnd.current) node.scrollTop = node.scrollHeight;
  }, [messages]);

  const close = () => {
    useAppStore.getState().closeDockPane(paneId);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`textarea[data-draft-owner="session:${parentSessionId}"]`)?.focus());
  };
  // Escape hides the side chat instead of reaching the main session's Stop.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  if (!side) return <div className="flex h-full items-center justify-center p-4">
    <button type="button" className="rounded-[8px] px-3 py-1.5 ui-control text-text-secondary hover:bg-background-3 hover:text-text-primary" onClick={() => void useAppStore.getState().openSideChat(parentSessionId)}>{t("sideChat.open")}</button>
  </div>;
  return <div data-side-chat className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
    <div ref={scroller} role="region" aria-label={t("sideChat.transcript")} tabIndex={0} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4"
      onScroll={(event) => { const node = event.currentTarget; atEnd.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48; }}>
      {messages.length === 0 ? <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="ui-control text-text-secondary">{t("sideChat.emptyTitle")}</p>
        <p className="max-w-[300px] ui-caption text-text-muted">{t("sideChat.emptyHint")}</p>
      </div> : <div className="flex flex-col gap-4">
        {messages.map((message) => <SideMessage key={message.id} message={message} parentSessionId={parentSessionId} />)}
      </div>}
    </div>
    <AgentRequests session={side} />
    <div className="shrink-0 px-3 pb-3">
      <AgentComposer session={side} agents={agents}
        onSend={(prompt, execution) => sendPrompt(prompt, execution, side.id)}
        onStop={() => void stopAgent(side.id)}
        onModelChange={(next, model) => void setSessionModel(next, model, side.id)} />
    </div>
  </div>;
}

const SideMessage = memo(function SideMessage({ message, parentSessionId }: { message: Message; parentSessionId: string }) {
  const t = useTranslation();
  const blocks = useMemo(() => message.role === "agent" && message.content ? parseTranscript(message.content) : null, [message.role, message.content]);
  if (message.role === "user") {
    return <div className="max-w-[88%] self-end whitespace-pre-wrap rounded-[16px] bg-background-3 px-3.5 py-2 ui-chat text-text-primary [overflow-wrap:anywhere]">{message.content}</div>;
  }
  const settled = !message.streaming && message.content.trim().length > 0;
  return <div className="min-w-0">
    {message.activity ? <AgentActivity activity={message.activity} /> : null}
    <div className="selectable min-w-0 whitespace-pre-wrap ui-chat text-text-secondary [overflow-wrap:anywhere]">
      {blocks ? blocks.map((block, index) => block.kind === "code"
        ? <div className="my-2" key={index}><SideCodeBlock code={block.content} language={block.language} maxLines={14} animateChanges={false} /></div>
        : <p key={index} className="whitespace-pre-wrap">{block.content}</p>)
        : message.activity ? null : message.streaming ? "…" : t("session.noOutput")}
    </div>
    {settled ? <div className="mt-1.5 flex items-center gap-0.5 text-text-muted">
      <Tooltip label={t("Copy message")}><span className="inline-flex"><CopyButton value={message.content} label={t("Copy message")} iconOnly variant="plain" className="size-6 min-h-0 text-text-muted [&_svg]:size-[13px]" /></span></Tooltip>
      <button type="button" className="inline-flex h-6 items-center gap-1.5 rounded-[7px] px-2 ui-caption text-text-muted hover:bg-background-3 hover:text-text-primary"
        onClick={() => takeToMain(parentSessionId, message.content)}><CornerUpLeft size={12} aria-hidden="true" />{t("sideChat.takeToMain")}</button>
    </div> : null}
  </div>;
});

/** Quotes the answer into the main session's draft; it is never sent automatically. */
function takeToMain(parentSessionId: string, content: string) {
  const store = useAppStore.getState();
  const owner = `session:${parentSessionId}`;
  const next = appendTranscriptQuote(store.composerDrafts[owner] ?? "", content);
  if (next === null) { useAppStore.setState({ error: "Draft exceeds the 64 KiB limit" }); return; }
  store.setComposerDraft(owner, next);
  requestAnimationFrame(() => {
    const area = document.querySelector<HTMLTextAreaElement>(`textarea[data-draft-owner="${owner}"]`);
    area?.focus({ preventScroll: true });
    area?.setSelectionRange(next.length, next.length);
  });
}
