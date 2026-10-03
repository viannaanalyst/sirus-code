import { useId, useState } from "react";
import type { ActivityCell } from "@/lib/profile-stats";
import { useTranslation } from "@/i18n/use-translation";
import { useAppStore } from "@/store/app-store";

export function ActivityHeatmap({ cells }: { cells: ActivityCell[] }) {
  const t = useTranslation(), locale = useAppStore(state => state.settings.locale);
  const [active, setActive] = useState<ActivityCell | null>(null);
  const hintId = useId();
  const lead = cells[0]?.weekday ?? 0;
  const columns = Math.ceil((cells.length + lead) / 7);
  const months = Array.from({ length: columns }, (_, column) => {
    const cell = cells[Math.max(0, column * 7 - lead)];
    const previous = cells[Math.max(0, (column - 1) * 7 - lead)];
    return cell && (column === 0 || cell.day.slice(0, 7) !== previous?.day.slice(0, 7)) ? new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(new Date(`${cell.day}T12:00:00Z`)).replace(".", "") : "";
  });
  const summary = active ? `${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${active.day}T12:00:00Z`))} · ${t("{count} prompts", { count: active.count })}` : t("Activity from retained Switchyard sessions.");
  return <figure className="profile-activity">
    <div className="profile-heatmap" role="group" aria-label={t("Activity calendar")} aria-describedby={hintId} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {Array.from({ length: lead }, (_, index) => <span key={`pad-${index}`} className="profile-heatmap-pad" />)}
      {cells.map(cell => <button key={cell.day} type="button" className="profile-heatmap-cell" data-level={cell.intensity}
        tabIndex={cell.count ? 0 : -1} aria-label={`${cell.day}: ${t("{count} prompts", { count: cell.count })}`}
        onMouseEnter={() => setActive(cell)} onFocus={() => setActive(cell)} onClick={() => setActive(cell)} />)}
    </div>
    <div className="profile-heatmap-months ui-caption" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>{months.map((month, index) => <span key={index}>{month}</span>)}</div>
    <figcaption id={hintId} className="profile-heatmap-caption ui-caption text-text-muted">{summary}</figcaption>
  </figure>;
}
