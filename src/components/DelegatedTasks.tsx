import { ChevronRight, Square } from "@/components/icons";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { providerById } from "@/lib/provider-registry";
import { IconButton } from "@/primitives/IconButton";
import { StatusIndicator } from "@/primitives/StatusIndicator";
import { selectSessionsMeta, useAppStore } from "@/store/app-store";

const ACTIVE = ["starting", "running", "waiting"];

/**
 * Tasks a reply delegated to other models (ADR-111), in the reply itself: who
 * runs each one, its live state, a Stop while it works, and a click opens it.
 */
export function DelegatedTasks({ ids }: { ids: string[] }) {
  const t = useTranslation();
  const sessions = useAppStore(selectSessionsMeta);
  const tasks = ids.map((id) => sessions.find((session) => session.id === id)).filter((session) => session !== undefined);
  if (!tasks.length) return null;
  return <div className="delegated-tasks" role="list" aria-label={t("delegate.tasks")}>
    {tasks.map((task) => {
      const active = ACTIVE.includes(task.status);
      return <div key={task.id} role="listitem" className="reply-card delegated-task">
        <ProviderIcon id={task.agent} size={16} />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void useAppStore.getState().selectSession(task.id)} aria-label={t("parent.open", { title: task.title })}>
          <span className="block truncate ui-control text-text-primary">{task.title}</span>
          <span className="block truncate ui-caption text-text-muted">{t("delegate.to", { provider: providerById(task.agent).name })}{task.model ? ` · ${task.model}` : ""} · {t(`delegate.state.${task.status}`)}</span>
        </button>
        <StatusIndicator status={task.status} />
        {active ? <IconButton label={t("delegate.stop", { title: task.title })} onClick={() => void useAppStore.getState().stopAgent(task.id)} className="size-6 min-h-0 rounded-[7px] p-0 text-text-muted"><Square aria-hidden="true" size={11} /></IconButton> : null}
        <ChevronRight size={13} aria-hidden="true" className="text-text-muted" />
      </div>;
    })}
  </div>;
}
