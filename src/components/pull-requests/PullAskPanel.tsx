import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { motion } from "motion/react";
import { Eraser, X } from "@/components/icons";
import type { GithubItem } from "@/client/types";
import { AgentComposer } from "@/components/AgentComposer";
import { AgentRequests } from "@/components/AgentRequests";
import { SideMessage } from "@/components/SideChatPane";
import { useTranslation } from "@/i18n/use-translation";
import { motionTokens } from "@/lib/motion";
import { clampPullAskWidth, findPullAsk, PULL_ASK_DEFAULT_WIDTH, PULL_ASK_MIN_WIDTH, pullAskKey } from "@/lib/pull-ask";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { useRetainedTranscripts } from "@/lib/use-retained-transcripts";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { IconButton } from "@/primitives/IconButton";
import { ResizeHandle } from "@/primitives/ResizablePanel";
import { useAppStore } from "@/store/app-store";
import "@/styles/pull-ask.css";
import { focusComposer } from "@/lib/composer-focus";

/** Survives closing the panel and switching items; memory only. */
let rememberedWidth = PULL_ASK_DEFAULT_WIDTH;

/**
 * Ask (ADR-050): a read-only conversation about one pull request or issue, beside its
 * detail. One conversation per item, hidden from session lists and reused when Ask
 * opens again; native wraps every message with fixed rules and the item's context.
 * `body` is the description the detail loaded (null until it has).
 */
export function PullAskPanel({ item, body, onClose }: { item: GithubItem; body: string | null; onClose: () => void }) {
  const t = useTranslation();
  const reducedMotion = useMotionPreferences();
  const [width, setWidth] = useState(rememberedWidth);
  const panel = useRef<HTMLElement>(null);
  const resize = (delta: number) => {
    const page = panel.current?.parentElement;
    const list = page?.firstElementChild as HTMLElement | null | undefined;
    const available = page ? page.clientWidth - (list?.offsetWidth ?? 0) : window.innerWidth;
    const next = clampPullAskWidth(width - delta, available);
    rememberedWidth = next;
    setWidth(next);
  };
  return <motion.aside ref={panel} aria-label={t("pulls.ask.label", { ref: pullAskKey(item) })} className="pulls-ask"
    initial={reducedMotion ? false : { width: 0, opacity: 0 }}
    animate={{ width, opacity: 1, transition: {
      width: { duration: reducedMotion ? 0 : motionTokens.fast, ease: motionTokens.ease },
      opacity: { delay: reducedMotion ? 0 : motionTokens.instant, duration: reducedMotion ? 0 : motionTokens.instant },
    } }}
    exit={{ width: 0, opacity: 0, transition: {
      opacity: { duration: reducedMotion ? 0 : motionTokens.instant },
      width: { delay: reducedMotion ? 0 : motionTokens.instant, duration: reducedMotion ? 0 : motionTokens.fast, ease: motionTokens.ease },
    } }}>
    <ResizeHandle value={width} onResize={resize} label={t("pulls.ask.resize")} min={PULL_ASK_MIN_WIDTH} max={Math.max(width, Math.floor(window.innerWidth * 0.6))} />
    <div className="pulls-ask-body" style={{ width: width - 4 }}>
      <PullAskConversation key={pullAskKey(item).toLowerCase()} item={item} body={body} onClose={onClose} />
    </div>
  </motion.aside>;
}

function PullAskConversation({ item, body, onClose }: { item: GithubItem; body: string | null; onClose: () => void }) {
  const t = useTranslation();
  const agents = useAppStore((state) => state.agents);
  const session = useAppStore((state) => findPullAsk(state.sessions, item.repository, item.number));
  const sendPrompt = useAppStore((state) => state.sendPrompt);
  const stopAgent = useAppStore((state) => state.stopAgent);
  const setSessionModel = useAppStore((state) => state.setSessionModel);
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const [clearing, setClearing] = useState(false);
  useRetainedTranscripts([session?.id]);

  // Opening refreshes the item's context natively, and creates the conversation the first time.
  const open = useCallback(async () => {
    if (body === null) return;
    setOpening(true);
    setFailed(false);
    const opened = await useAppStore.getState().openPullAsk(item, body);
    setOpening(false);
    if (!opened) { setFailed(true); return; }
    requestAnimationFrame(() => focusComposer(`session:${opened.id}`, { preventScroll: true }));
  }, [item, body]);
  const ready = body !== null;
  const opened = useRef(false);
  useEffect(() => {
    if (!ready || opened.current) return;
    opened.current = true;
    void open();
  }, [ready, open]);

  const scroller = useRef<HTMLDivElement>(null);
  const messages = useMemo(() => session?.messages.filter((message) => message.role !== "system") ?? [], [session?.messages]);
  const atEnd = useRef(true);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && atEnd.current) node.scrollTop = node.scrollHeight;
  }, [messages]);

  // Escape closes the panel; it never stops the conversation.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  const running = !!session && ["starting", "running", "waiting"].includes(session.status);
  const clear = async () => {
    if (!session) return true;
    const deleted = await useAppStore.getState().deleteSession(session.id, false);
    if (!deleted) return false;
    void open();
    return true;
  };
  const ref = pullAskKey(item);

  return <div data-pull-ask className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
    <header className="pulls-ask-header">
      <div className="min-w-0 flex-1">
        <p className="truncate ui-control text-text-primary">{t("pulls.ask.title", { ref })}</p>
        <p className="truncate ui-caption text-text-muted">{t("pulls.ask.readOnly")}</p>
      </div>
      <IconButton label={t("pulls.ask.clear")} disabled={!session || running || opening || messages.length === 0} onClick={() => setClearing(true)}><Eraser size={14} /></IconButton>
      <IconButton label={t("pulls.ask.close")} onClick={onClose}><X size={14} /></IconButton>
    </header>
    {!session ? <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
      {failed ? <button type="button" className="rounded-[8px] px-3 py-1.5 ui-control text-text-secondary hover:bg-background-3 hover:text-text-primary" onClick={() => void open()}>{t("pulls.ask.retry")}</button>
        : <p role="status" className="ui-caption text-text-muted">{t("pulls.ask.opening")}</p>}
    </div> : <>
      <div ref={scroller} role="region" aria-label={t("pulls.ask.transcript")} tabIndex={0} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4"
        onScroll={(event) => { const node = event.currentTarget; atEnd.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48; }}>
        {messages.length === 0 ? <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="ui-control text-text-secondary">{t("pulls.ask.emptyTitle", { kind: t(`pulls.ask.kind.${item.kind}`) })}</p>
          <p className="max-w-[300px] ui-caption text-text-muted">{t("pulls.ask.emptyHint")}</p>
        </div> : <div className="flex flex-col gap-4">
          {messages.map((message) => <SideMessage key={message.id} message={message} />)}
        </div>}
      </div>
      <AgentRequests session={session} />
      <div className="shrink-0 px-3 pb-3">
        <AgentComposer session={session} agents={agents}
          onSend={(prompt, execution) => sendPrompt(prompt, execution, session.id)}
          onStop={() => void stopAgent(session.id)}
          onModelChange={(next, model) => void setSessionModel(next, model, session.id)} />
      </div>
    </>}
    <ConfirmDialog open={clearing} onOpenChange={setClearing} title={t("pulls.ask.clearTitle")} description={t("pulls.ask.clearBody")}
      confirmLabel={t("pulls.ask.clear")} onConfirm={clear} />
  </div>;
}
