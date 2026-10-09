import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState, type RefObject } from "react";
import { CalendarDays, Clock3 } from "@/components/icons/phosphor";
import type { Session } from "@/client/types";
import { useArcReducedMotion } from "@/components/arc/lib/use-arc-motion";
import { useTranslation } from "@/i18n/use-translation";
import { cascadeIndex, useCascade } from "@/lib/cascade";
import { customSnoozeTime, dateInputValue, SNOOZE_PRESETS, snoozeClock, snoozeCountdown, snoozeDeadline, snoozePresetTime, timeInputValue } from "@/lib/snooze";
import { Popover, PopoverAnchor, PopoverContent } from "@/primitives/Popover";
import { useAppStore } from "@/store/app-store";

/** Live "back in 2 h 10 min"; it ticks on its own so the row around it does not re-render. */
export function SnoozeCountdown({ until }: { until: string }) {
  const t = useTranslation();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return <>{snoozeCountdown(until, now, t)}</>;
}

/**
 * "Snooze…" (ADR-103): the presets, then a date and time of the person's choosing. It opens
 * beside the element that asked for it (a switcher row or a header tab) as a small popover.
 */
export function SnoozePicker({ session, anchor, onClose }: { session: Session | null; anchor: HTMLElement | null; onClose: () => void }) {
  const t = useTranslation();
  const locale = useAppStore(state => state.settings.locale);
  const open = Boolean(session && anchor);
  const cascade = useCascade(open);
  const reduced = useArcReducedMotion();
  const [custom, setCustom] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  // Each opening starts on the presets, with tomorrow's morning ready in the custom fields.
  const key = open ? session!.id : null;
  if (key !== shown) {
    setShown(key);
    if (key) {
      const now = new Date(), start = session?.snoozedUntil ? new Date(session.snoozedUntil) : snoozePresetTime("tomorrow", now);
      setCustom(false);
      setDate(dateInputValue(start));
      setTime(timeInputValue(start));
    }
  }
  const virtual = useMemo(() => ({ current: anchor }) as RefObject<HTMLElement | null>, [anchor]);
  const now = new Date();
  const picked = customSnoozeTime(date, time, now);
  const choose = (at: Date) => {
    if (!session) return;
    onClose();
    void useAppStore.getState().snoozeSession(session.id, at.toISOString());
  };
  return <Popover open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <PopoverAnchor virtualRef={virtual} />
    <PopoverContent side="right" align="start" sideOffset={8} className="floating-material snooze-picker" data-cascade={cascade ? "" : undefined} aria-label={session ? t("snooze.title", { title: session.title }) : undefined}>
      {session ? <>
        <p className="snooze-picker-title" data-cascade-item="" style={cascadeIndex(0)}>{t("snooze.title", { title: session.title })}</p>
        {SNOOZE_PRESETS.map((preset, index) => {
          const at = snoozePresetTime(preset, now);
          const hint = preset === "hour" || preset === "threeHours" ? snoozeClock(at, locale) : at.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
          return <button key={preset} type="button" className="snooze-picker-row" data-cascade-item="" style={cascadeIndex(index + 1)} onClick={() => choose(at)}>
            <Clock3 size={14} aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{t(`snooze.preset.${preset}`)}</span><span className="snooze-picker-hint">{hint}</span>
          </button>;
        })}
        <button type="button" className="snooze-picker-row" data-cascade-item="" style={cascadeIndex(SNOOZE_PRESETS.length + 1)} aria-expanded={custom} onClick={() => setCustom(value => !value)}>
          <CalendarDays size={14} aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{t("snooze.custom")}</span>
        </button>
        <AnimatePresence initial={false}>
          {custom ? <motion.form key="custom" className="snooze-picker-custom" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={reduced ? { duration: 0 } : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onSubmit={event => { event.preventDefault(); if (picked) choose(picked); }}>
            <div className="snooze-picker-fields">
              <label><span>{t("snooze.date")}</span><input type="date" value={date} min={dateInputValue(now)} onChange={event => setDate(event.target.value)} /></label>
              <label><span>{t("snooze.time")}</span><input type="time" value={time} onChange={event => setTime(event.target.value)} /></label>
            </div>
            <div className="snooze-picker-confirm">
              <span className="snooze-picker-hint">{picked ? snoozeDeadline(picked, now, locale, t) : t("snooze.invalid")}</span>
              <button type="submit" disabled={!picked}>{t("snooze.confirm")}</button>
            </div>
          </motion.form> : null}
        </AnimatePresence>
      </> : null}
    </PopoverContent>
  </Popover>;
}
