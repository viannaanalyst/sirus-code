import { useState } from "react";
import { Eye, GitMerge, MessageSquare, XCircle } from "@/components/icons/phosphor";
import type { PrWatch, PrWatchEvent } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { watchedEvents } from "@/lib/pull-requests";
import { relativeTime } from "@/lib/session-board";
import { Switch } from "@/primitives/Switch";
import { useAppStore } from "@/store/app-store";
import "@/styles/pull-request.css";

const EVENT_ICON = { checks: XCircle, reviews: MessageSquare, conflict: GitMerge } as const;

function ago(at: string | null | undefined, t: ReturnType<typeof useTranslation>) {
  if (!at) return null;
  const time = relativeTime(at);
  return time === "now" ? t("Now") : time;
}

/** What one watch wakes its session for, with the state it last saw (ADR-079). */
export function PrWatchEvents({ watch }: { watch: PrWatch }) {
  const t = useTranslation();
  const settings = useAppStore(store => store.settings);
  const fixes = useAppStore(store => store.ciAutoFix);
  const { checksByAutoFix } = watchedEvents(watch, settings, fixes);
  const state: Record<PrWatchEvent, string> = {
    checks: checksByAutoFix ? t("prWatch.checksByAutoFix") : watch.failedChecks.length ? t("prWatch.failing", { count: watch.failedChecks.length }) : "",
    reviews: watch.seen.length ? t("prWatch.told", { count: watch.seen.length }) : "",
    conflict: watch.conflicting ? t("prWatch.conflicting") : "",
  };
  return <ul className="pr-watch-events" aria-label={t("prWatch.events")}>
    {(["checks", "reviews", "conflict"] as const).map(event => {
      const Icon = EVENT_ICON[event];
      return <li key={event} className="pr-watch-event ui-caption">
        <Icon size={12} aria-hidden="true" className="shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate text-text-secondary">{t(`prWatch.event.${event}`)}</span>
        {state[event] ? <span className="shrink-0 truncate text-text-muted">{state[event]}</span> : null}
      </li>;
    })}
  </ul>;
}

/** Footer line: PR, who started it, last update. */
function Meta({ watch }: { watch: PrWatch }) {
  const t = useTranslation();
  const last = ago(watch.lastWakeAt, t);
  return <p className="pr-watch-meta ui-caption text-text-muted">
    {t(watch.origin === "agent" ? "prWatch.byAgent" : "prWatch.byYou", { number: watch.pullRequest })}
    {last ? <> · {t("prWatch.lastUpdate", { events: watch.lastEvents.map(event => t(`prWatch.short.${event}`)).join(", "), time: last })}</> : null}
  </p>;
}

/** Environment card popover: the per-session switch, what is watched and a way to stop. */
export function PrWatchPanel({ sessionId }: { sessionId: string }) {
  const t = useTranslation();
  const watch = useAppStore(store => store.prWatches.find(item => item.sessionId === sessionId));
  const action = useAppStore(store => store.prWatchAction);
  const [busy, setBusy] = useState(false);
  const watching = watch?.status === "watching";
  const set = async (on: boolean) => {
    setBusy(true);
    await action({ type: "set", sessionId, watching: on });
    setBusy(false);
  };
  return <div className="pr-watch-panel">
    <div className="pr-watch-switch">
      <span className="min-w-0 flex-1 ui-control text-text-primary">{t("prWatch.toggle")}</span>
      <Switch checked={watching} disabled={busy} label={t("prWatch.toggle")} onChange={on => void set(on)} />
    </div>
    {busy ? <p className="px-2 ui-caption text-text-muted" role="status">{t("prWatch.lookingUp")}</p>
      : !watch ? <p className="px-2 ui-caption text-text-muted">{t("prWatch.help")}</p> : null}
    {watch ? <>
      {watch.status === "stopped" ? <p className="pr-watch-stopped ui-caption" role="status">{t(`prWatch.reason.${watch.reason ?? "wakeLimit"}`)}</p> : null}
      <PrWatchEvents watch={watch} />
      <Meta watch={watch} />
      {watch.status === "stopped" ? <div className="pr-watch-actions">
        <button type="button" className="pr-watch-action ui-caption" disabled={busy} onClick={() => void set(true)}>{t("prWatch.again")}</button>
        <button type="button" className="pr-watch-action ui-caption" disabled={busy} onClick={() => void set(false)}>{t("prWatch.dismiss")}</button>
      </div> : null}
    </> : null}
  </div>;
}

/** Environment card trailing badge while a watch exists. */
export function PrWatchBadge({ sessionId }: { sessionId: string }) {
  const t = useTranslation();
  const watch = useAppStore(store => store.prWatches.find(item => item.sessionId === sessionId));
  if (!watch) return null;
  return <span className="pr-watch-badge ui-caption tabular-nums" data-status={watch.status} title={t(watch.status === "watching" ? "prWatch.watching" : "prWatch.stopped")}>
    <span className="pr-watch-dot" aria-hidden="true" />#{watch.pullRequest}
  </span>;
}

/** Pull requests page: sessions watching this PR, what they watch and Stop. */
export function PrWatchList({ watches }: { watches: PrWatch[] }) {
  const t = useTranslation();
  const sessions = useAppStore(store => store.sessions);
  const action = useAppStore(store => store.prWatchAction);
  if (!watches.length) return null;
  return <section className="mb-5">
    <div className="mb-1.5 flex items-center gap-2"><Eye size={13} className="text-text-muted" aria-hidden="true" /><h3 className="ui-section-title text-text-muted">{t("prWatch.listTitle")}</h3></div>
    <div className="rounded-[10px] border border-border-subtle px-3 py-2">
      {watches.map(watch => {
        const session = sessions.find(item => item.id === watch.sessionId);
        return <div key={watch.sessionId} className="pr-watch-list-item">
          <div className="flex items-center gap-2">
            <button type="button" className="min-w-0 flex-1 truncate text-left ui-control text-text-primary hover:underline" onClick={() => {
              const store = useAppStore.getState();
              store.setMainView("session");
              void store.selectSession(watch.sessionId);
            }}>{session?.title ?? t("prWatch.unknownSession")}</button>
            <span className="shrink-0 ui-caption text-text-muted">{t(watch.status === "watching" ? "prWatch.watching" : "prWatch.stopped")}</span>
            <button type="button" className="pr-watch-action ui-caption" onClick={() => void action({ type: "set", sessionId: watch.sessionId, watching: false })}>{t("prWatch.stop")}</button>
          </div>
          <PrWatchEvents watch={watch} />
          <Meta watch={watch} />
        </div>;
      })}
    </div>
  </section>;
}
