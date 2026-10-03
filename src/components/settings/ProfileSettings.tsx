import { useEffect, useMemo, useState } from "react";
import { Pencil, Share2 } from "lucide-react";
import type { AppSettings, HostInfo, Session } from "@/client/types";
import { client } from "@/client";
import { selectSessionsMeta, useAppStore } from "@/store/app-store";
import { useTranslation } from "@/i18n/use-translation";
import { buildProfileStats, profileIdentity } from "@/lib/profile-stats";
import { PROVIDERS } from "@/lib/provider-registry";
import { modelDisplayName } from "@/lib/model-registry";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { ActivityHeatmap } from "@/components/profile/ActivityHeatmap";
import { EditProfileDialog } from "@/components/profile/EditProfileDialog";
import { ShareProfileDialog } from "@/components/profile/ShareProfileDialog";
import { ModelIcon } from "@/components/ModelIcon";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { SettingsSection } from "./SettingsSection";
import { ProviderIcon } from "./ProviderIcon";
import { useProfileDay } from "@/components/profile/use-profile-day";
import "@/styles/profile.css";

export function ProfileSettings({ settings, host }: { settings: AppSettings; host: HostInfo | null }) {
  const t = useTranslation();
  const projects = useAppStore(state => state.projects), sessions = useAppStore(selectSessionsMeta), catalogs = useAppStore(state => state.modelsByProvider);
  const today = useProfileDay();
  // Transcripts load per session (ADR-048): native returns owned prompt times only,
  // already past any fork-inherited prefix.
  const [prompts, setPrompts] = useState<Map<string, { id: string; createdAt: string }[]> | null>(null);
  useEffect(() => {
    let cancelled = false;
    client.transcriptActivity().then(rows => { if (!cancelled) setPrompts(new Map(rows.map(row => [row.sessionId, row.prompts]))); }, () => {});
    return () => { cancelled = true; };
  }, [sessions]);
  const stats = useMemo(() => buildProfileStats(projects, sessions.map((session): Session => ({ ...session, forkOrigin: null,
    messages: (prompts?.get(session.id) ?? []).map(prompt => ({ id: prompt.id, sessionId: session.id, role: "user", content: "", createdAt: prompt.createdAt, streaming: false })) })), new Date(), today), [projects, sessions, prompts, today]);
  const [editOpen, setEditOpen] = useState(false), [shareOpen, setShareOpen] = useState(false);
  const defaultName = host?.profileDefaultName || "Switchyard", identity = profileIdentity(settings.profile, defaultName);
  const number = new Intl.NumberFormat(settings.locale);
  const days = (count: number) => t(count === 1 ? "{count} day" : "{count} days", { count: number.format(count) });
  const topProvider = PROVIDERS.find(provider => provider.id === stats.topProvider?.provider);
  const metric = (label: string, value: string) => <div key={label}><span className="profile-stat-value ui-section-title">{value}</span><span className="ui-description text-text-muted">{t(label)}</span></div>;
  return <div className="profile-settings"><SettingsSection title={t("Profile")} headerAction={<div className="flex items-center gap-2">
    <InteractiveButton variant="secondary" glow={false} onClick={() => setShareOpen(true)}><Share2 size={14} aria-hidden="true" />{t("Share")}</InteractiveButton>
    <InteractiveButton variant="secondary" glow={false} onClick={() => setEditOpen(true)}><Pencil size={14} aria-hidden="true" />{t("Edit")}</InteractiveButton>
  </div>}>
    <header className="profile-identity"><ProfileAvatar profile={settings.profile} initials={identity.initials} />
      <h3 className="ui-title text-text-primary">{identity.name}</h3><p className="ui-body text-text-muted"><span>{identity.handle}</span><span aria-hidden="true">·</span><span className="profile-brand-badge ui-caption">Switchyard</span></p>
    </header>
    <div className="profile-stat-tiles">
      {metric("Lifetime tokens", "—")}{metric("Peak token day", "—")}{metric("Total prompts", number.format(stats.totalPrompts))}
      {metric("Current streak", days(stats.currentStreak))}{metric("Longest streak", days(stats.longestStreak))}
    </div>
    <section className="profile-section"><h3 className="ui-section-title text-text-primary">{t("Activity")}</h3><ActivityHeatmap cells={stats.heatmap} /></section>
    <div className="profile-insight-columns">
      <section className="profile-section"><h3 className="ui-section-title text-text-primary">{t("Activity insights")}</h3><dl className="profile-insights ui-body">
        <div><dt>{t("Most used provider")}</dt><dd>{topProvider ? <><ProviderIcon id={topProvider.id} size={14} />{topProvider.name}<span className="text-text-muted">· {number.format(stats.topProvider!.percent)}%</span></> : "—"}</dd></div>
        <div><dt>{t("Most used reasoning")}</dt><dd>{stats.topReasoning ? `${stats.topReasoning.effort} · ${number.format(stats.topReasoning.percent)}%` : "—"}</dd></div>
        <div><dt>{t("Most active hour")}</dt><dd>{stats.peakHour !== null ? new Intl.DateTimeFormat(settings.locale, { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2000, 0, 1, stats.peakHour))) : "—"}</dd></div>
        <div><dt>{t("Most worked project")}</dt><dd>{stats.mostWorkedProject ? `${stats.mostWorkedProject.name} · ${t("{count} prompts", { count: stats.mostWorkedProject.count })}` : "—"}</dd></div>
        <div><dt>{t("Total sessions")}</dt><dd>{number.format(stats.totalSessions)}</dd></div>
        <div><dt>{t("Total projects")}</dt><dd>{number.format(stats.totalProjects)}</dd></div>
      </dl><p className="ui-description text-text-muted">{t("Provider, model and reasoning shares use current selections in sessions with activity.")}</p></section>
      <section className="profile-section"><h3 className="ui-section-title text-text-primary">{t("Most used plugins")}</h3><p className="ui-body text-text-muted">{t("Plugin and skill activity is not tracked yet.")}</p></section>
    </div>
    <section className="profile-section"><h3 className="ui-section-title text-text-primary">{t("Model usage")}</h3><p className="ui-description text-text-muted">{t("Share of sessions with activity, by their current model.")}</p>
      {stats.models.length ? <ul className="profile-model-list">{stats.models.slice(0, 6).map(entry => {
        const name = entry.model ? modelDisplayName(entry.provider, catalogs[entry.provider]?.models.find(model => model.id === entry.model)?.displayName ?? entry.model) : t("models.cliDefault");
        return <li key={JSON.stringify([entry.provider, entry.model])}><div className="profile-model-label ui-body"><span><ModelIcon provider={entry.provider} modelId={entry.model ?? ""} size={15} /><span className="truncate">{name}</span></span><span className="text-text-muted tabular-nums">{number.format(entry.percent)}%</span></div>
          <div className="profile-model-meter" role="meter" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={entry.percent}><span style={{ transform: `scaleX(${entry.percent / 100})` }} /></div>
        </li>;
      })}</ul> : <p className="ui-body text-text-muted">{t("No model activity yet.")}</p>}
    </section>
    <footer className="profile-data-note ui-description text-text-muted"><p>{t("Activity from retained Switchyard sessions. Imports and inherited fork messages are excluded.")}</p><p>{t("Historical token totals are unavailable.")}</p></footer>
    <EditProfileDialog open={editOpen} onOpenChange={setEditOpen} profile={settings.profile} defaultName={defaultName} />
    <ShareProfileDialog open={shareOpen} onOpenChange={setShareOpen} profile={settings.profile} defaultName={defaultName} stats={stats} />
  </SettingsSection></div>;
}
