import { useEffect, useState } from "react";
import type { Session } from "@/client/types";
import { Clock3, Gauge, Play, X } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";
import { resetDistance, RESUME_GRACE_MS } from "@/lib/usage-limit";
import { useAppStore } from "@/store/app-store";
import "@/styles/context-meter.css";

/** Above the composer when the last turn hit the provider's usage limit. */
export function UsageLimitNotice({ session }: { session: Session }) {
  const t = useTranslation();
  const locale = useAppStore((state) => state.settings.locale);
  const dismissed = useAppStore((state) => Boolean(state.usageLimitDismissed[session.id]));
  const armed = useAppStore((state) => Boolean(state.usageResumeArmed[session.id]));
  const lookedUp = useAppStore((state) => state.usageLimitResets[session.id]);
  const limit = session.usageLimit;
  const resetsAt = limit?.resetsAt ?? lookedUp ?? null;
  const [now, setNow] = useState(Date.now);
  const waiting = resetsAt != null && resetsAt + RESUME_GRACE_MS > now;
  const missingReset = Boolean(limit) && limit?.resetsAt == null;
  useEffect(() => {
    if (missingReset) void useAppStore.getState().lookupUsageLimitReset(session.id);
  }, [missingReset, session.id]);
  // The countdown moves by minutes; it stops once the limit has reset.
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [waiting]);
  if (!limit || dismissed) return null;
  const store = useAppStore.getState();
  const running = session.status === "starting" || session.status === "running" || session.status === "waiting";
  const when = () => {
    if (resetsAt == null) return t("usageLimit.unknown");
    if (!waiting) return t("usageLimit.reset");
    const date = new Date(resetsAt);
    const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    const day = date.toDateString() === new Date(now).toDateString() ? t("usageLimit.at", { time }) : t("usageLimit.on", { day: date.toLocaleDateString(locale, { day: "numeric", month: "short" }), time });
    const { days, hours, minutes } = resetDistance(resetsAt - now);
    const distance = days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
    return t("usageLimit.resets", { time: day, distance });
  };
  return <section aria-label={t("usageLimit.title")} className="usage-limit mx-auto mb-2 flex w-full max-w-[var(--chat-column-width)] items-center gap-2 rounded-2xl border px-3 py-2">
    <Gauge size={15} aria-hidden="true" className="usage-limit-icon shrink-0" />
    <span className="shrink-0 ui-control text-text-primary">{t("usageLimit.title")}</span>
    <span role="status" className="min-w-0 flex-1 truncate ui-caption text-text-muted">{when()}</span>
    {waiting ? <button type="button" aria-pressed={armed} disabled={running} title={t(armed ? "usageLimit.cancelArmed" : "usageLimit.armHint")} className={cn("usage-limit-action ui-caption", armed && "usage-limit-armed")} onClick={() => store.armUsageResume(session.id, !armed)}>
      <Clock3 size={13} aria-hidden="true" />{t(armed ? "usageLimit.armed" : "usageLimit.resumeAtReset")}
    </button> : <button type="button" disabled={running} title={t("usageLimit.resumeHint")} className="usage-limit-action ui-caption" onClick={() => void store.resumeAfterUsageLimit(session.id)}>
      <Play size={13} aria-hidden="true" />{t("usageLimit.resume")}
    </button>}
    <button type="button" aria-label={t("usageLimit.dismiss")} className="usage-limit-close" onClick={() => store.dismissUsageLimit(session.id)}><X size={13} aria-hidden="true" /></button>
  </section>;
}
