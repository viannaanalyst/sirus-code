import { useMemo } from "react";
import { Archive, ArchiveRestore } from "@/components/icons/phosphor";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { relativeTime } from "@/lib/session-board";
import { archiveSidebarSession } from "@/lib/sidebar-layout";
import { IconButton } from "@/primitives/IconButton";
import { StatusIndicator } from "@/primitives/StatusIndicator";
import { selectListedSessions, useAppStore } from "@/store/app-store";
import "@/styles/inbox.css";

/**
 * Archived sessions as a page of their own, opened from the rail like Tasks: newest
 * first, each one opens its conversation or goes back to the sidebar with Restore.
 */
export function ArchivedPage() {
  const t = useTranslation();
  const sessions = useAppStore(selectListedSessions);
  const projects = useAppStore((state) => state.projects);
  const archivedIds = useAppStore((state) => state.settings.archivedSessionIds);
  const archived = useMemo(() => {
    const ids = new Set(archivedIds);
    return sessions.filter((session) => ids.has(session.id)).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }, [sessions, archivedIds]);
  const open = (id: string) => { const store = useAppStore.getState(); store.setMainView("session"); void store.selectSession(id); };
  const restore = (id: string) => { const store = useAppStore.getState(); void store.saveSettings(archiveSidebarSession(store.settings, id)); };

  return <section className="inbox-page" aria-label={t("Archived sessions")}>
    <div className="scroll-thin inbox-scroll">
      <div className="inbox-column">
        <header className="flex items-center gap-2">
          <h1 className="ui-title flex-1 text-text-primary">{t("Archived sessions")}</h1>
        </header>
        {archived.length ? <section className="inbox-section" aria-label={t("Archived sessions")}>
          {archived.map((session) => {
            const time = relativeTime(session.lastActivityAt);
            return <div key={session.id} className="inbox-row archived-row">
              <button type="button" className="archived-row-open" onClick={() => open(session.id)}>
                <ProviderIcon id={session.agent} size={16} />
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate ui-control text-text-primary">{session.title}</span>
                  <span className="block truncate ui-caption text-text-muted">{projects.find((project) => project.id === session.projectId)?.name ?? ""}</span>
                </span>
                <StatusIndicator status={session.status} />
                <span className="w-10 shrink-0 text-right ui-caption text-text-muted">{time === "now" ? t("Now") : time}</span>
              </button>
              <IconButton label={t("Restore session")} onClick={() => restore(session.id)}><ArchiveRestore size={14} /></IconButton>
            </div>;
          })}
        </section> : <div className="inbox-empty">
          <Archive size={30} className="text-text-muted" />
          <p className="ui-control text-text-primary">{t("No archived sessions")}</p>
        </div>}
      </div>
    </div>
  </section>;
}
