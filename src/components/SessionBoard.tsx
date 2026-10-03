import { ArrowLeft, GitBranch, Plus } from "lucide-react";
import { useState } from "react";
import { useAppStore, selectCurrentProject } from "@/store/app-store";
import { useTranslation } from "@/i18n/use-translation";
import { groupProjectSessions, relativeTime, SESSION_COLUMNS } from "@/lib/session-board";
import { AgentIcon } from "@/components/AgentIcon";
import { IconButton } from "@/primitives/IconButton";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { StatusIndicator } from "@/primitives/StatusIndicator";
import type { Project, Session } from "@/client/types";

export function SessionBoard() {
  const t = useTranslation();
  const project = useAppStore(selectCurrentProject);
  const projects = useAppStore((state) => state.projects);
  const sessions = useAppStore((state) => state.sessions);
  const selectProject = useAppStore((state) => state.selectProject);
  const selectSession = useAppStore((state) => state.selectSession);
  const setMainView = useAppStore((state) => state.setMainView);
  const requestNewSession = useAppStore((state) => state.requestNewSession);
  const addProjectFromPicker = useAppStore((state) => state.addProjectFromPicker);
  const [boardProjectId, setBoardProjectId] = useState<string | null>(null);
  const boardProject = projects.find((item) => item.id === boardProjectId) ?? null;

  const openNewSession = (projectId: string) => {
    void selectProject(projectId).then(() => requestNewSession());
  };

  return (
    <section aria-label={t("Kanban")} className="flex min-w-0 flex-1 flex-col p-4">
      <div className="mb-4 flex items-center gap-2">
        <IconButton
          label={t(boardProject ? "Back to Kanban" : "Back to session")}
          onClick={() => {
            if (boardProject) setBoardProjectId(null);
            else setMainView("session");
          }}
          className="size-[24px] min-h-0 rounded-[6px] p-0"
        >
          <ArrowLeft size={14} />
        </IconButton>
        <h2 className="max-w-[clamp(16rem,50vw,40rem)] truncate ui-title">{boardProject ? boardProject.name : t("Kanban")}</h2>
        <span className="shrink-0 ui-description text-text-muted">
          {t("{count} sessions", { count: boardProject ? sessions.filter((session) => session.projectId === boardProject.id).length : sessions.length })}
        </span>
        <InteractiveButton variant="ghost" className="ml-auto" disabled={!project && !boardProject} onClick={() => {
          const target = boardProject?.id ?? project?.id;
          if (target) openNewSession(target);
        }}>
          <Plus size={13} />{t("New session")}
        </InteractiveButton>
      </div>
      {projects.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="ui-body text-text-muted">{t("Open a project to view its sessions.")}</p>
          <InteractiveButton onClick={() => void addProjectFromPicker()}>{t("Open project")}</InteractiveButton>
        </div>
      ) : (
        <div className="scroll-thin grid min-h-0 flex-1 auto-cols-[minmax(230px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
          {boardProject ? (
            <ProjectBoard project={boardProject} sessions={sessions} onOpen={(session) => void selectSession(session.id)} onNew={() => openNewSession(boardProject.id)} />
          ) : (
            projects.map((item) => (
              <ProjectColumn
                key={item.id}
                project={item}
                sessions={sessions.filter((session) => session.projectId === item.id).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))}
                onOpen={(session) => void selectSession(session.id)}
                onOpenBoard={() => setBoardProjectId(item.id)}
                onNew={() => openNewSession(item.id)}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

function ProjectColumn({
  project,
  sessions,
  onOpen,
  onOpenBoard,
  onNew,
}: {
  project: Project;
  sessions: Session[];
  onOpen: (session: Session) => void;
  onOpenBoard: () => void;
  onNew: () => void;
}) {
  const t = useTranslation();
  return (
    <section aria-label={project.name} className="flex min-h-0 min-w-0 flex-col">
      <header className="flex items-center gap-2 px-1 pb-2">
        <button type="button" onClick={onOpenBoard} className="min-w-0 truncate ui-control font-medium text-text-secondary hover:text-text-primary" title={project.path}>
          {project.name}
        </button>
        <span className="shrink-0 ui-caption tabular-nums text-text-muted">{sessions.length}</span>
        <button
          type="button"
          aria-label={t("New session")}
          title={t("New session")}
          onClick={onNew}
          className="ml-auto rounded-[6px] p-1 text-text-muted transition-colors duration-[var(--motion-fast)] hover:bg-background-3 hover:text-text-primary"
        >
          <Plus size={13} />
        </button>
      </header>
      <div className="scroll-thin flex min-h-0 flex-col gap-2 overflow-y-auto">
        {sessions.length === 0 ? <p className="px-1 py-2 ui-caption text-text-muted">{t("No sessions in this column")}</p> : null}
        {sessions.map((session) => <KanbanCard key={session.id} session={session} onOpen={() => onOpen(session)} />)}
      </div>
    </section>
  );
}

function ProjectBoard({ project, sessions, onOpen, onNew }: { project: Project; sessions: Session[]; onOpen: (session: Session) => void; onNew: () => void }) {
  const t = useTranslation();
  const columns = groupProjectSessions(sessions, project.id);
  return (
    <>
      {SESSION_COLUMNS.map((column) => (
        <section key={column.id} aria-label={t(column.label)} className="flex min-h-0 min-w-0 flex-col">
          <header className="flex items-center gap-2 px-1 pb-2">
            <h3 className="truncate ui-control font-medium text-text-secondary">{t(column.label)}</h3>
            <span className="shrink-0 ui-caption tabular-nums text-text-muted">{columns[column.id].length}</span>
            {column.id === "queued" ? (
              <button
                type="button"
                aria-label={t("New session")}
                title={t("New session")}
                onClick={onNew}
                className="ml-auto rounded-[6px] p-1 text-text-muted transition-colors duration-[var(--motion-fast)] hover:bg-background-3 hover:text-text-primary"
              >
                <Plus size={13} />
              </button>
            ) : null}
          </header>
          <div className="scroll-thin flex min-h-0 flex-col gap-2 overflow-y-auto">
            {columns[column.id].length === 0 ? <p className="px-1 py-2 ui-caption text-text-muted">{t("No sessions in this column")}</p> : null}
            {columns[column.id].map((session) => <KanbanCard key={session.id} session={session} onOpen={() => onOpen(session)} />)}
          </div>
        </section>
      ))}
    </>
  );
}

function KanbanCard({ session, onOpen }: { session: Session; onOpen: () => void }) {
  const t = useTranslation();
  return (
    <button
      type="button"
      aria-label={t("Open session · {title}", { title: session.title })}
      onClick={onOpen}
      className="flex w-full shrink-0 flex-col items-stretch rounded-[10px] border border-border-subtle bg-background-2 p-2.5 text-left transition-colors duration-[var(--motion-fast)] hover:border-border-default hover:bg-background-3"
    >
      <span className="line-clamp-2 ui-control font-medium">{session.title}</span>
      <span className="mt-2 flex min-w-0 items-center gap-2 ui-micro text-text-muted">
        <AgentIcon id={session.agent} className="shrink-0" />
        {session.worktree.branch ? (
          <span className="flex min-w-0 items-center gap-1">
            <GitBranch size={11} className="shrink-0" />
            <span className="max-w-[90px] truncate">{session.worktree.branch}</span>
          </span>
        ) : null}
        <span className="ml-auto shrink-0 tabular-nums">{relativeTime(session.lastActivityAt)}</span>
        <span className="flex shrink-0 items-center gap-1 rounded-full border border-border-subtle px-1.5 py-px">
          <StatusIndicator status={session.status} />
          {t(`status.${session.status}`)}
        </span>
      </span>
    </button>
  );
}
