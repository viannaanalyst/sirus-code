import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Session } from "@/client/types";
import { Search } from "@/components/icons/phosphor";
import { ProjectGlyph } from "@/components/ProjectGlyph";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { motionTokens } from "@/lib/motion";
import { relativeTime } from "@/lib/session-board";
import { stepSentence } from "@/lib/turn-timeline";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { selectListedSessions, useAppStore } from "@/store/app-store";
import "@/styles/quick-switcher.css";

type Group = { id: "needs" | "working" | "recent"; label: string; sessions: Session[] };

const busy = (session: Session) => session.status === "running" || session.status === "starting";
const needsYou = (session: Session) => session.status === "waiting" || Boolean(session.pendingRequests?.length);

/**
 * ⌘J (ADR-093, after MonoCode): jump between conversations across projects. Sessions that
 * need you, then those working (each with what it is doing now), then recent ones; typing
 * filters, ↑↓ moves, Enter opens. Navigation only — replies happen in the conversation.
 */
export function QuickSwitcher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslation();
  const reduced = useMotionPreferences();
  const sessions = useAppStore(selectListedSessions);
  const projects = useAppStore((state) => state.projects);
  const archived = useAppStore((state) => state.settings.archivedSessionIds);
  const transcripts = useAppStore((state) => state.sessions);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (open) { setQuery(""); setCursor(0); setNow(Date.now()); } }, [open]);

  const groups = useMemo<Group[]>(() => {
    const needle = query.trim().toLocaleLowerCase();
    const hidden = new Set(archived);
    const names = new Map(projects.map((project) => [project.id, project.name]));
    const visible = sessions.filter((session) => !hidden.has(session.id) && (!needle || `${session.title} ${names.get(session.projectId) ?? ""}`.toLocaleLowerCase().includes(needle)));
    const recent = (rows: Session[]) => [...rows].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    const needs = recent(visible.filter(needsYou));
    const working = recent(visible.filter((session) => busy(session) && !needsYou(session)));
    const rest = recent(visible.filter((session) => !busy(session) && !needsYou(session))).slice(0, needle ? 30 : 8);
    return [
      { id: "needs" as const, label: t("quickSwitch.needsYou"), sessions: needs },
      { id: "working" as const, label: t("quickSwitch.working"), sessions: working },
      { id: "recent" as const, label: t("quickSwitch.recent"), sessions: rest },
    ].filter((group) => group.sessions.length);
  }, [sessions, projects, archived, query, t]);
  const flat = groups.flatMap((group) => group.sessions);

  // What a conversation is doing now: its running step, else the start of its last reply.
  const doing = (session: Session): string => {
    const full = transcripts.find((row) => row.id === session.id);
    const last = full?.messages.at(-1);
    if (needsYou(session)) return t("quickSwitch.waiting");
    if (busy(session)) {
      const step = last?.activity?.items.filter((item) => item.kind !== "agent").at(-1);
      return step ? stepSentence(step, t, session.worktree.path) : t("quickSwitch.workingNow");
    }
    const reply = [...(full?.messages ?? [])].reverse().find((message) => message.role === "agent" && message.content.trim());
    return reply ? reply.content.replace(/[#*_`>]/g, "").trim().split("\n").find((line) => line.trim()) ?? "" : t(`status.${session.status}`);
  };

  const choose = (session: Session | undefined) => {
    if (!session) return;
    onClose();
    const store = useAppStore.getState();
    store.setMainView("session");
    void store.selectSession(session.id);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((index) => (index + (event.key === "ArrowDown" ? 1 : flat.length - 1)) % Math.max(flat.length, 1));
    } else if (event.key === "Enter") { event.preventDefault(); choose(flat[cursor]); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
  };
  useEffect(() => { list.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" }); }, [cursor]);

  let index = -1;
  return <AnimatePresence>
    {open ? <motion.div key="quick" className="quick-switch-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : motionTokens.fast }}>
      <motion.div role="dialog" aria-label={t("quickSwitch.title")} className="quick-switch floating-material"
        initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }}
        transition={{ duration: reduced ? 0 : motionTokens.fast, ease: motionTokens.ease }}>
        <label className="quick-switch-search">
          <Search size={14} aria-hidden="true" />
          <input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setCursor(0); }} onKeyDown={onKey} placeholder={t("quickSwitch.placeholder")} aria-label={t("quickSwitch.placeholder")} />
          <kbd>⌘J</kbd>
        </label>
        <div ref={list} className="quick-switch-list scroll-thin" role="listbox" aria-label={t("quickSwitch.title")}>
          {groups.map((group) => <section key={group.id} aria-label={group.label}>
            <p className="quick-switch-group"><span className="quick-switch-dot" data-group={group.id} aria-hidden="true" />{group.label}<span>{group.sessions.length}</span></p>
            {group.sessions.map((session) => {
              index += 1;
              const position = index;
              const project = projects.find((row) => row.id === session.projectId);
              const time = relativeTime(session.lastActivityAt, now);
              return <button key={session.id} type="button" role="option" data-index={position} aria-selected={position === cursor} className="quick-switch-item"
                onMouseEnter={() => setCursor(position)} onClick={() => choose(session)}>
                <span className="quick-switch-title"><ProviderIcon id={session.agent} size={14} className="rounded-none bg-transparent" /><span className="truncate">{session.title}</span></span>
                <span className="quick-switch-doing"><span aria-hidden="true">⠿</span><span className="truncate">{doing(session)}</span></span>
                <span className="quick-switch-meta">{project ? <ProjectGlyph project={project} size={13} /> : null}<span className="truncate">{project?.name}</span><span className="ml-auto shrink-0">{time === "now" ? t("Now") : time}</span></span>
              </button>;
            })}
          </section>)}
          {!flat.length ? <p className="quick-switch-empty">{t("quickSwitch.empty")}</p> : null}
        </div>
      </motion.div>
    </motion.div> : null}
  </AnimatePresence>;
}
