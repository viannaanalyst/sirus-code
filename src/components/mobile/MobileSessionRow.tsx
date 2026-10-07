import { useState } from "react";
import type { AppSettings, Project, Session } from "@/client/types";
import { AgentIcon } from "@/components/AgentIcon";
import { ProjectGlyph } from "@/components/ProjectGlyph";
import { Archive, ArchiveRestore, LoaderCircle, Pin, Trash2 } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { sessionBadge, shortAgo } from "@/lib/mobile";
import { toggleSidebarId } from "@/lib/sidebar-layout";
import { useAppStore } from "@/store/app-store";
import { MobileDeleteDialog } from "./MobileDialog";
import { MobileSwipeRow, type SwipeAction } from "./MobileSwipeRow";

const BADGE_KEYS = { approve: "mobile.approve", question: "mobile.question", working: "mobile.workingBadge", failed: "mobile.failed", stopped: "mobile.stopped" } as const;

/** One conversation in a phone list: project, state, title, branch and age. */
export function MobileSessionRow({ session, project, showProject = true, pinned = false, onOpen }: { session: Session; project: Project | undefined; showProject?: boolean; pinned?: boolean; onOpen: () => void }) {
  const t = useTranslation();
  const locale = useAppStore((state) => state.settings.locale);
  const badge = sessionBadge(session);
  return <button type="button" className="mobile-row" onClick={onOpen}>
    <span className="mobile-row-top">
      {showProject && project ? <span className="mobile-row-project"><ProjectGlyph project={project} size={13} />{project.name}</span> : null}
      {badge ? <span className="mobile-badge" data-badge={badge}>{badge === "working" ? <LoaderCircle size={11} className="animate-spin" aria-hidden="true" /> : null}{t(BADGE_KEYS[badge])}</span> : null}
    </span>
    <span className="mobile-row-title">{pinned ? <Pin size={12} fill="currentColor" className="mobile-row-pin" aria-label={t("mobile.pinned")} /> : null}{session.title}</span>
    <span className="mobile-row-meta">
      <span className="mobile-row-branch">{session.worktree.branch}</span>
      <span aria-hidden="true">·</span>
      <span>{shortAgo(session.lastActivityAt, locale)}</span>
      <AgentIcon id={session.agent} className="mobile-row-agent" />
    </span>
  </button>;
}

/**
 * A conversation row with its swipe actions (ADR-086): pin, archive and delete in a
 * list, or restore and delete among archived ones. Delete asks first.
 */
export function MobileSessionItem({ session, project, showProject = true, archived = false, onOpen }: { session: Session; project: Project | undefined; showProject?: boolean; archived?: boolean; onOpen: () => void }) {
  const t = useTranslation();
  const pinned = useAppStore((state) => state.settings.pinnedSessionIds.includes(session.id));
  const [deleting, setDeleting] = useState(false);
  const active = ["starting", "running", "waiting"].includes(session.status);
  const save = (change: (settings: AppSettings) => AppSettings) => { const state = useAppStore.getState(); void state.saveSettings(change(state.settings)); };
  const actions: SwipeAction[] = archived ? [
    { id: "restore", label: t("mobile.unarchive"), icon: <ArchiveRestore size={18} />, tone: "accent", onSelect: () => save((settings) => ({ ...settings, archivedSessionIds: settings.archivedSessionIds.filter((id) => id !== session.id) })) },
    { id: "delete", label: t("mobile.delete"), icon: <Trash2 size={18} />, tone: "danger", disabled: active, onSelect: () => setDeleting(true) },
  ] : [
    { id: "pin", label: t(pinned ? "mobile.unpin" : "mobile.pin"), icon: <Pin size={18} fill={pinned ? "currentColor" : "none"} />, tone: "accent", onSelect: () => save((settings) => ({ ...settings, pinnedSessionIds: toggleSidebarId(settings.pinnedSessionIds, session.id) })) },
    { id: "archive", label: t("mobile.archive"), icon: <Archive size={18} />, tone: "warning", disabled: active, onSelect: () => useAppStore.getState().requestArchive(session.id, true) },
    { id: "delete", label: t("mobile.delete"), icon: <Trash2 size={18} />, tone: "danger", disabled: active, onSelect: () => setDeleting(true) },
  ];
  return <>
    <MobileSwipeRow actions={actions}><MobileSessionRow session={session} project={project} showProject={showProject} pinned={pinned && !archived} onOpen={onOpen} /></MobileSwipeRow>
    <MobileDeleteDialog session={session} open={deleting} onClose={() => setDeleting(false)} />
  </>;
}
