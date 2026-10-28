import { memo, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Bot, Box, ChevronRight, FilePenLine, Lightbulb, Search, Terminal, Wrench } from "@/components/icons";
import type { ActivityKind, ActivityStep, SubagentFeedEntry } from "@/client/types";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { MemberMark, MemberStatusMark, useTick } from "@/components/SubagentTeam";
import { useTranslation } from "@/i18n/use-translation";
import { formatActivityDuration } from "@/lib/agent-activity";
import { memberElapsed, memberStatus, visibleWindow } from "@/lib/subagent-team";
import { useAppStore } from "@/store/app-store";
import { useSubagentFeed } from "@/store/subagent-feeds";
import { focusComposer } from "@/lib/composer-focus";

const kindIcons: Record<ActivityKind, typeof Search> = { read: Search, edit: FilePenLine, command: Terminal, tool: Wrench, agent: Bot, skill: Box };
/** Rows rendered at first; earlier ones open in pages of the same size. */
const PAGE = 120;

/**
 * A subagent's live view in the right dock (ADR-146): what it was asked, its messages,
 * thinking and tool calls as they stream, read-only, with its state and elapsed time. Its
 * feed lives outside the app store, so streaming re-renders this pane only.
 */
export function SubagentPane({ paneId, sessionId, view }: { paneId: string; sessionId: string; view: { messageId: string; itemId: string; key: string; label: string } }) {
  const t = useTranslation();
  const item = useAppStore((state) => state.sessions.find((session) => session.id === sessionId)?.messages.find((message) => message.id === view.messageId)?.activity?.items.find((entry) => entry.id === view.itemId) ?? null);
  const provider = useAppStore((state) => state.sessions.find((session) => session.id === sessionId)?.messages.find((message) => message.id === view.messageId)?.activity?.provider ?? null);
  const cwd = useAppStore((state) => state.sessions.find((session) => session.id === sessionId)?.worktree.path);
  const closeDockPane = useAppStore((state) => state.closeDockPane);
  const status = item ? memberStatus(item) : "unknown";
  const running = status === "running";
  const feed = useSubagentFeed(sessionId, view.key, running);
  const now = useTick(running);
  const elapsed = item ? memberElapsed({ startedAt: item.startedAt ?? null, endedAt: item.endedAt ?? null }, now) : null;
  const name = item?.label.trim() || view.label;
  const back = () => {
    closeDockPane(paneId);
    requestAnimationFrame(() => focusComposer(`session:${sessionId}`));
  };
  const [shown, setShown] = useState(PAGE);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const { start, hidden } = visibleWindow(feed.entries.length, shown);
  const visible = feed.entries.slice(start);
  // Follows the newest entry while the reader is at the bottom; scrolling up stops it.
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && stick.current) node.scrollTop = node.scrollHeight;
  }, [feed.entries]);
  const steps = item?.steps ?? [];
  const fallback = !feed.entries.length && feed.source !== "loading";
  return <section className="subagent-view" aria-label={t("subagentView.label", { name })}>
    <header className="subagent-view-head">
      <button type="button" className="subagent-view-back" onClick={back} aria-label={t("subagentView.back")} title={t("subagentView.back")}><ArrowLeft size={14} aria-hidden="true" /></button>
      {provider ? <MemberMark provider={provider} model={item?.model ?? null} /> : null}
      <span className="subagent-view-name" title={name}>{name}</span>
      <span className="subagent-view-meta">
        {elapsed !== null ? <span className="activity-duration">{formatActivityDuration(elapsed)}</span> : null}
        <span>{t("subagentView.readOnly")}</span>
      </span>
      <MemberStatusMark status={status} />
    </header>
    <div ref={scroller} className="subagent-view-scroll" onScroll={(event) => { const node = event.currentTarget; stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48; }}>
      {!item ? <p className="subagent-view-note">{t("subagentView.gone")}</p> : null}
      {feed.dropped ? <p className="subagent-view-note">{t("subagentView.dropped", { count: feed.dropped })}</p> : null}
      {hidden ? <button type="button" className="subagent-view-earlier" onClick={() => { stick.current = false; setShown((count) => count + PAGE); }}>{t("subagentView.earlier", { count: Math.min(PAGE, hidden) })}</button> : null}
      <ol className="subagent-feed">
        {visible.map((entry) => <FeedRow key={entry.id} entry={entry} sessionId={sessionId} cwd={cwd} />)}
      </ol>
      {feed.source === "loading" ? <p className="subagent-view-note" role="status">{t("subagentView.loading")}</p> : null}
      {fallback && running ? <p className="subagent-view-note" role="status">{t("subagentView.waiting")}</p> : null}
      {fallback && !running && item ? <>
        <p className="subagent-view-note">{t(steps.length ? "subagentView.empty" : "subagentView.nothing")}</p>
        {steps.length ? <ol className="subagent-feed">{steps.map((step) => <StepRow key={step.id} step={step} />)}</ol> : null}
      </> : null}
      {feed.source === "transcript" && feed.entries.length ? <p className="subagent-view-note">{t("subagentView.fromTranscript")}</p> : null}
    </div>
  </section>;
}

/** One entry; unchanged entries keep their identity across merges, so they do not render again. */
const FeedRow = memo(function FeedRow({ entry, sessionId, cwd }: { entry: SubagentFeedEntry; sessionId: string; cwd?: string }) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  if (entry.kind === "text") return <li className="subagent-entry" data-kind="text"><div className="ui-chat text-text-secondary"><ChatMarkdown text={entry.text ?? ""} sessionId={sessionId} cwd={cwd} /></div></li>;
  if (entry.kind === "prompt") return <li className="subagent-entry" data-kind="prompt">
    <button type="button" className="subagent-prompt" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span className="subagent-entry-caption">{t("subagentView.prompt")}</span>
      <span className="subagent-prompt-text" data-open={open || undefined}>{entry.text}</span>
    </button>
  </li>;
  if (entry.kind === "thinking") return <li className="subagent-entry" data-kind="thinking">
    <button type="button" className="subagent-line" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Lightbulb size={13} className="subagent-line-icon" aria-hidden="true" />
      <span className="subagent-line-label">{open ? t("subagentView.thinking") : (entry.text ?? "").split("\n").find((line) => line.trim()) ?? t("subagentView.thinking")}</span>
      <ChevronRight size={11} className={open ? "tl-detail-chevron tl-fold-open" : "tl-detail-chevron"} aria-hidden="true" />
    </button>
    {open ? <p className="subagent-thinking">{entry.text}</p> : null}
  </li>;
  const Icon = kindIcons[entry.tool ?? "tool"];
  const output = entry.output?.trim();
  const body = <>
    <Icon size={13} className="subagent-line-icon" aria-hidden="true" />
    <span className="subagent-line-label"><span className="subagent-tool-name">{t(entry.label || "Tool call")}</span>{entry.detail ? <span className="subagent-tool-detail"> {entry.detail}</span> : null}</span>
    <MemberStatusMark status={entry.state === "running" ? "running" : entry.state === "failed" ? "failed" : entry.state === "stopped" ? "stopped" : entry.state === "completed" ? "completed" : "unknown"} />
    {output ? <ChevronRight size={11} className={open ? "tl-detail-chevron tl-fold-open" : "tl-detail-chevron"} aria-hidden="true" /> : null}
  </>;
  return <li className="subagent-entry" data-kind="tool" data-state={entry.state}>
    {output ? <button type="button" className="subagent-line" aria-expanded={open} aria-label={`${entry.label ?? ""} ${entry.detail ?? ""} · ${t("subagentView.output")}`.trim()} onClick={() => setOpen((value) => !value)}>{body}</button> : <div className="subagent-line">{body}</div>}
    {open && output ? <pre className="subagent-output">{output}</pre> : null}
  </li>;
});

function StepRow({ step }: { step: ActivityStep }) {
  const t = useTranslation();
  const Icon = kindIcons[step.kind];
  return <li className="subagent-entry" data-kind="tool" data-state={step.state}>
    <div className="subagent-line">
      <Icon size={13} className="subagent-line-icon" aria-hidden="true" />
      <span className="subagent-line-label">{t(step.label || "Tool call")}</span>
      <MemberStatusMark status={step.state} />
    </div>
  </li>;
}
