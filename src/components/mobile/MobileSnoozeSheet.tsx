import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Session } from "@/client/types";
import { CalendarDays, Clock3, Moon } from "@/components/icons";
import { usePhoneTranslation as useTranslation } from "./use-phone-host";
import { motionTokens } from "@/lib/motion";
import { customSnoozeTime, dateInputValue, phoneSnoozeChoices, snoozeClock, snoozeDeadline, snoozePresetTime, timeInputValue } from "@/lib/snooze";
import { useAppStore } from "@/store/app-store";
import { MobileActionSheet } from "./MobileDialog";

/**
 * Snoozing from a phone list (ADR-103, ADR-124): quick choices, then a date and time of the
 * person's choosing. Same store action as the Mac's picker, so the conversation leaves the
 * lists until it comes back and the undo toast follows.
 */
export function MobileSnoozeSheet({ session, open, onClose, onSnooze }: { session: Session; open: boolean; onClose: () => void; /** Snoozes elsewhere (a conversation on another computer, ADR-132); the store's action otherwise. */ onSnooze?: (until: string) => void }) {
  const t = useTranslation();
  const locale = useAppStore((state) => state.settings.locale);
  const [custom, setCustom] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [shown, setShown] = useState(false);
  // Each opening starts on the quick choices, with the current snooze (or tomorrow's morning) in the fields.
  if (open !== shown) {
    setShown(open);
    if (open) {
      const start = session.snoozedUntil ? new Date(session.snoozedUntil) : snoozePresetTime("tomorrow", new Date());
      setCustom(false);
      setDate(dateInputValue(start));
      setTime(timeInputValue(start));
    }
  }
  const now = new Date();
  const picked = customSnoozeTime(date, time, now);
  const choose = (at: Date) => {
    onClose();
    if (onSnooze) onSnooze(at.toISOString());
    else void useAppStore.getState().snoozeSession(session.id, at.toISOString());
  };
  return <MobileActionSheet open={open} title={t("snooze.phoneTitle")} description={t("snooze.phoneHelp")} onClose={onClose}>
    <div className="mobile-snooze-list">
      {phoneSnoozeChoices(now).map(({ preset, at }) => <button key={preset} type="button" className="mobile-snooze-row" onClick={() => choose(at)}>
        {preset === "evening" ? <Moon size={17} aria-hidden="true" /> : <Clock3 size={17} aria-hidden="true" />}
        <span className="mobile-snooze-label">{t(`snooze.preset.${preset}`)}</span>
        <span className="mobile-snooze-hint">{preset === "hour" || preset === "evening" ? snoozeClock(at, locale) : at.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" })}</span>
      </button>)}
      <button type="button" className="mobile-snooze-row" aria-expanded={custom} onClick={() => setCustom((value) => !value)}>
        <CalendarDays size={17} aria-hidden="true" /><span className="mobile-snooze-label">{t("snooze.custom")}</span>
      </button>
    </div>
    <AnimatePresence initial={false}>
    {custom ? <motion.form key="custom" className="mobile-snooze-custom" onSubmit={(event) => { event.preventDefault(); if (picked) choose(picked); }}
      initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: motionTokens.normal, ease: motionTokens.ease }}>
      <div className="mobile-snooze-fields">
        <label><span>{t("snooze.date")}</span><input className="mobile-input" type="date" value={date} min={dateInputValue(now)} onChange={(event) => setDate(event.target.value)} /></label>
        <label><span>{t("snooze.time")}</span><input className="mobile-input" type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label>
      </div>
      <p className="mobile-help mobile-center" role="status">{picked ? snoozeDeadline(picked, now, locale, t) : t("snooze.invalid")}</p>
      <button type="submit" className="mobile-primary" disabled={!picked}>{t("snooze.confirm")}</button>
    </motion.form> : null}
    </AnimatePresence>
    <button type="button" className="mobile-dialog-button mobile-snooze-cancel" onClick={onClose}>{t("common.cancel")}</button>
  </MobileActionSheet>;
}
