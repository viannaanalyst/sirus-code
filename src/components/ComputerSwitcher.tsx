import { useMemo } from "react";
import { Laptop, Server } from "@/components/icons";
import type { Project } from "@/client/types";
import { ProjectIcon } from "@/components/ProjectAvatar";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { mergeComputerProjects, type ComputerProject } from "@/lib/computers";
import { HOME_ENVIRONMENT, environmentLabel } from "@/lib/environments";
import { relativeTime } from "@/lib/session-board";
import { computerLabel, useComputers } from "@/store/computers-store";
import "@/styles/computers.css";

/** A computer's icon: a laptop for a Mac, a server otherwise. */
export function ComputerIcon({ id, kind, size = 13 }: { id: string; kind: "mac" | "server"; size?: number }) {
  return id === HOME_ENVIRONMENT || kind === "mac" ? <Laptop size={size} aria-hidden="true" /> : <Server size={size} aria-hidden="true" />;
}

/**
 * The project switcher across computers: no computer picker in
 * the header; other computers' projects join this list, matched by name, and their conversations
 * list beside this computer's with the machine's icon.
 */
export function useMergedComputers(projects: readonly Pick<Project, "id" | "name">[]) {
  const computers = useComputers((state) => state.computers);
  const activeId = useComputers((state) => state.activeId);
  const connection = useComputers((state) => state.connection);
  const summaries = useComputers((state) => state.summaries);
  const hostInfo = useComputers((state) => state.hostInfo);
  return useMemo(() => mergeComputerProjects(projects, computers, activeId, summaries, connection, (computer) => computer.id === HOME_ENVIRONMENT
    ? computer.label.trim() || hostInfo[HOME_ENVIRONMENT]?.hostName?.trim() || "Mac"
    : environmentLabel(computer, "Server")), [projects, computers, activeId, summaries, connection, hostInfo]);
}

const usable = (member: ComputerProject) => member.status === "online" || member.status === "active";

/** On a project row here: the other computers that also have it. */
export function ComputerBadge({ members }: { members: readonly ComputerProject[] | undefined }) {
  const t = useTranslation();
  if (!members?.length) return null;
  const names = [...new Set(members.map((member) => member.label))].join(", ");
  return <span className="switcher-machine" role="img" aria-label={t("computers.alsoOn", { names })} title={t("computers.alsoOn", { names })}>
    <ComputerIcon id={members[0].computerId} kind={members[0].kind} size={12} />
  </span>;
}

/** Projects only on another computer, after this one's; choosing one opens it there. */
export function SwitcherElsewhereProjects({ members, needle, focused, onFocus, onChoose }: { members: readonly ComputerProject[]; needle: string; focused: string | null; onFocus: (key: string) => void; onChoose: () => void }) {
  const t = useTranslation();
  const shown = members.filter((member) => !needle || member.project.name.toLocaleLowerCase().includes(needle) || member.sessions.some((session) => session.title.toLocaleLowerCase().includes(needle)));
  return <>{shown.map((member) => {
    const key = memberKey(member);
    const title = usable(member) ? t("computers.on", { name: member.label }) : t("computers.offlineNote", { name: member.label });
    return <button key={key} type="button" className="header-switcher-row switcher-elsewhere" data-offline={!usable(member) || undefined} aria-selected={focused === key} title={title}
      onMouseEnter={() => onFocus(key)} onFocus={() => onFocus(key)}
      onClick={() => { if (!usable(member)) return; onChoose(); void useComputers.getState().openProject(member.computerId, member.project.id); }}>
      <ProjectIcon project={member.project} size={15} />
      <span className="header-tab-title"><span>{member.project.name}</span></span>
      <span className="switcher-machine" aria-label={title}><ComputerIcon id={member.computerId} kind={member.kind} size={12} /></span>
    </button>;
  })}</>;
}

export const memberKey = (member: ComputerProject) => `${member.computerId}\0${member.project.id}`;

/** Another computer's conversations of the focused project, with its icon; one opens there. */
export function SwitcherRemoteSessions({ members, needle, onChoose }: { members: readonly ComputerProject[]; needle: string; onChoose: () => void }) {
  const t = useTranslation();
  return <>{members.flatMap((member) => member.sessions
    .filter((session) => !needle || session.title.toLocaleLowerCase().includes(needle) || member.project.name.toLocaleLowerCase().includes(needle))
    .map((session) => {
      const time = relativeTime(session.lastActivityAt);
      const title = usable(member) ? t("computers.on", { name: member.label }) : t("computers.offlineNote", { name: member.label });
      return <div key={`${member.computerId}:${session.id}`} className="header-switcher-session switcher-remote-session" data-offline={!usable(member) || undefined} title={title}>
        <button type="button" className="header-switcher-session-open" disabled={!usable(member)}
          onClick={() => { onChoose(); void useComputers.getState().openSession(member.computerId, session.id); }}>
          <ProviderIcon id={session.agent} size={13} />
          <span className="header-tab-title"><span>{session.title}</span></span>
          <span className="switcher-machine" aria-label={title}><ComputerIcon id={member.computerId} kind={member.kind} size={12} /></span>
        </button>
        <span className="header-switcher-trail"><span className="header-switcher-time">{time === "now" ? t("Now") : time}</span></span>
      </div>;
    }))}</>;
}

/**
 * The computer a conversation runs on, as a quiet label tucked under the composer: shown for a conversation on another computer than this Mac.
 */
export function ComputerTray() {
  const t = useTranslation();
  const computers = useComputers((state) => state.computers);
  const activeId = useComputers((state) => state.activeId);
  useComputers((state) => state.hostInfo);
  const active = computers.find((computer) => computer.id === activeId);
  if (!active || activeId === HOME_ENVIRONMENT) return null;
  const name = computerLabel(activeId);
  return <div className="relative z-[5] px-6"><div className="mx-auto w-full max-w-[var(--chat-column-width)]">
    <div className="landing-tray flex items-center gap-1">
      <span className="composer-computer px-2 py-1 ui-caption" title={t("computers.on", { name })}><ComputerIcon id={active.id} kind={active.kind} size={13} />{name}</span>
    </div>
  </div></div>;
}
