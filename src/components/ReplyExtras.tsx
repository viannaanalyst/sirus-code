import { ChevronRight, MessagesSquare } from "@/components/icons";
import type { Message } from "@/client/types";
import { DelegatedTasks } from "@/components/DelegatedTasks";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { StatusIndicator } from "@/primitives/StatusIndicator";
import { selectSessionsMeta, useAppStore } from "@/store/app-store";
import "@/styles/reply-extras.css";

/**
 * What a reply started (ADR-111): tasks it delegated to other models as live cards, and
 * sessions it started with `sirus_create_session` behind a Sessions control.
 */
export function ReplyExtras({ message }: { message: Message }) {
  const launched = message.launched ?? [];
  const delegated = useAppStore((state) => launched.filter((id) => selectSessionsMeta(state).find((session) => session.id === id)?.delegatedBy?.notify).join("\n"));
  if (!launched.length) return null;
  const tasks = delegated ? delegated.split("\n") : [];
  const others = launched.filter((id) => !tasks.includes(id));
  return <div className="reply-extras">
    {tasks.length ? <DelegatedTasks ids={tasks} /> : null}
    {others.length ? <StartedSessions ids={others} /> : null}
  </div>;
}

function StartedSessions({ ids }: { ids: string[] }) {
  const t = useTranslation();
  const sessions = useAppStore(selectSessionsMeta);
  const active = ids.filter((id) => ["starting", "running", "waiting"].includes(sessions.find((session) => session.id === id)?.status ?? "")).length;
  return <Popover>
    <PopoverTrigger asChild>
      <button type="button" className="reply-sessions-trigger ui-caption">
        <MessagesSquare size={13} />
        {t("reply.launched", { count: ids.length })}
        {active ? <StatusIndicator status="running" /> : null}
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="reply-sessions-panel">
      {ids.map((id) => <SessionCard key={id} id={id} />)}
    </PopoverContent>
  </Popover>;
}

function SessionCard({ id }: { id: string }) {
  const t = useTranslation();
  const target = useAppStore((state) => selectSessionsMeta(state).find((session) => session.id === id) ?? null);
  const project = useAppStore((state) => target ? state.projects.find((item) => item.id === target.projectId)?.name : undefined);
  if (!target) return <div className="reply-card ui-caption text-text-muted">{t("reply.sessionGone")}</div>;
  return <button type="button" className="reply-card reply-card-link" onClick={() => void useAppStore.getState().selectSession(target.id)}>
    <ProviderIcon id={target.agent} size={16} />
    <span className="min-w-0 flex-1 text-left">
      <span className="block truncate ui-control text-text-primary">{target.title}</span>
      <span className="block truncate ui-caption text-text-muted">{project}{target.model ? ` · ${target.model}` : ""} · {target.worktree.branch}</span>
    </span>
    <StatusIndicator status={target.status} />
    <ChevronRight size={13} className="text-text-muted" />
  </button>;
}
