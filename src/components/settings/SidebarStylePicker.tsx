import { useId, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { Project, Session } from "@/client/types";
import { ArrowLeft, ArrowRight, ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, FolderPlus, PanelLeft, Search, Settings, SquarePen } from "@/components/icons/phosphor";
import { ModelIcon } from "@/components/ModelIcon";
import { ProjectGlyph } from "@/components/ProjectGlyph";
import { RailGlyph } from "@/components/SidebarRailMore";
import { useTranslation } from "@/i18n/use-translation";
import { conversationListItems, projectConversationItems, projectStripOrder, type ConversationListItem, type ConversationListSettings } from "@/lib/conversation-list";
import { tabStatus } from "@/lib/header-tabs";
import { RAIL_LABELS } from "@/lib/rail";
import { relativeTime } from "@/lib/session-board";
import { selectListedSessions, useAppStore } from "@/store/app-store";
import "@/styles/sidebar.css";
import "@/styles/header-tabs.css";
import "@/styles/conversation-sidebar.css";
import "@/styles/sidebar-style-picker.css";

export type SidebarStyleChoice = "rail" | "list" | "project" | "hidden";

/** The scene each thumbnail draws at full size before scaling it down (px). */
const SCENE_WIDTH = 1000;
const NO_SET: ReadonlySet<string> = new Set();

/** A project's icon without its favicon lookup, so the thumbnails make no native calls. */
function Glyph({ project, size }: { project: Project; size: number }) {
  return <ProjectGlyph project={{ look: project.look }} size={size} />;
}

interface Sample {
  project: Project | null;
  title: string;
  recent: ConversationListItem[];
  byTime: ConversationListItem[];
  strip: Project[];
}

/** The person's own first projects and conversations, read once from the store (no IPC). */
function useSample(): Sample {
  const projects = useAppStore(state => state.projects);
  const sessions = useAppStore(selectListedSessions);
  const archivedSessionIds = useAppStore(state => state.settings.archivedSessionIds);
  const pinnedSessionIds = useAppStore(state => state.settings.pinnedSessionIds);
  const pinnedProjectIds = useAppStore(state => state.settings.pinnedProjectIds);
  const sidebarProjectOrder = useAppStore(state => state.settings.sidebarProjectOrder);
  const sidebarProjectSortOrder = useAppStore(state => state.settings.sidebarProjectSortOrder);
  const selectedProjectId = useAppStore(state => state.selectedProjectId);
  const selectedSessionId = useAppStore(state => state.selectedSessionId);
  return useMemo(() => {
    const settings: ConversationListSettings = { archivedSessionIds, pinnedSessionIds, sidebarAttentionFirst: false, sidebarThreadSortOrder: "updated_at" };
    const project = projects.find(row => row.id === selectedProjectId) ?? projects[0] ?? null;
    const recent = conversationListItems(projects, sessions, settings, "recent").slice(0, 7);
    const byTime = projectConversationItems(projects, sessions, settings, project?.id ?? null, Date.now()).slice(0, 11);
    const current = sessions.find(row => row.id === selectedSessionId) ?? (recent[0]?.kind === "session" ? recent[0].session : null);
    return { project, title: current?.title ?? "", recent, byTime, strip: projectStripOrder(projects, { pinnedProjectIds, sidebarProjectOrder, sidebarProjectSortOrder }).slice(0, 7) };
  }, [projects, sessions, archivedSessionIds, pinnedSessionIds, pinnedProjectIds, sidebarProjectOrder, sidebarProjectSortOrder, selectedProjectId, selectedSessionId]);
}

function Lights() {
  return <span className="sidebar-thumb-lights"><i /><i /><i /></span>;
}

/** The shared rows of both column styles: search, order, New project (and New conversation); Inbox · Tasks · PRs. */
function ToolRows({ withNew }: { withNew: boolean }) {
  const t = useTranslation();
  return <>
    <span className="conversation-sidebar-tools">
      <span className="conversation-sidebar-search"><Search size={14} /><span>{t("sidebarList.search")}</span></span>
      <span className="conversation-sidebar-order"><ArrowUpDown size={15} /></span>
      <span className="conversation-sidebar-order"><FolderPlus size={15} /></span>
      {withNew ? <span className="conversation-sidebar-order"><SquarePen size={15} /></span> : null}
    </span>
    <span className="conversation-sidebar-nav">
      {(["inbox", "tasks", "pulls"] as const).map(id => <span key={id} className="conversation-sidebar-nav-item"><RailGlyph id={id} size={14} /><span>{id === "pulls" ? t("sidebarList.pulls") : t(RAIL_LABELS[id])}</span></span>)}
    </span>
  </>;
}

function Dot({ session }: { session: Session }) {
  const status = tabStatus(session, NO_SET);
  return status === "running" || status === "waiting" ? <span className="header-tab-status" data-status={status} /> : null;
}

function ListSidebar({ sample }: { sample: Sample }) {
  const t = useTranslation();
  const now = Date.now();
  return <span className="sidebar-material conversation-sidebar sidebar-thumb-column" data-style="list">
    <span className="conversation-sidebar-head"><Lights /><span className="conversation-sidebar-brand">Sirus <span>Code</span></span><span className="conversation-sidebar-head-button"><PanelLeft size={14} /></span></span>
    <ToolRows withNew />
    <span className="conversation-sidebar-list"><span className="conversation-sidebar-rows">
      {sample.recent.map(item => item.kind === "session" ? <span key={item.key} className="conversation-row" data-variant="full">
        <span className="conversation-row-open">
          <span className="conversation-row-meta"><Glyph project={item.project} size={13} /><span className="conversation-row-project">{item.project.name}</span><span className="conversation-row-age">{relativeTime(item.session.lastActivityAt, now)}</span><Dot session={item.session} /></span>
          <span className="conversation-row-title"><span>{item.session.title}</span></span>
          <span className="conversation-row-detail"><span className="conversation-row-branch">{item.session.worktree.branch}</span><ModelIcon modelId={item.session.model ?? ""} provider={item.session.agent} size={13} /></span>
        </span>
      </span> : null)}
      {!sample.recent.length ? <span className="conversation-sidebar-empty">{t("sidebarList.empty")}</span> : null}
    </span></span>
    <span className="conversation-sidebar-foot"><span className="flex-1" /><RailGlyph id="archived" size={17} /><Settings size={17} /></span>
  </span>;
}

function ProjectSidebar({ sample }: { sample: Sample }) {
  const t = useTranslation();
  const now = Date.now();
  return <span className="sidebar-material conversation-sidebar sidebar-thumb-column" data-style="project">
    <span className="conversation-sidebar-head"><Lights /><span className="flex-1" /><span className="conversation-sidebar-head-button"><PanelLeft size={14} /></span><span className="conversation-sidebar-head-button"><ArrowLeft size={14} /></span><span className="conversation-sidebar-head-button"><ArrowRight size={14} /></span></span>
    <span className="conversation-sidebar-switch">
      <span className="header-project conversation-sidebar-project">{sample.project ? <Glyph project={sample.project} size={14} /> : null}<span className="truncate">{sample.project?.name ?? "Sirus Code"}</span><ChevronDown size={12} /></span>
      <span className="conversation-sidebar-order conversation-sidebar-tool"><SquarePen size={15} /></span>
    </span>
    <ToolRows withNew={false} />
    <span className="conversation-sidebar-list"><span className="conversation-sidebar-rows">
      {sample.byTime.map(item => item.kind === "time"
        ? <span key={item.key} className="conversation-time-group">{t(item.group === "pinned" ? "Pinned" : `sidebarList.${item.group}`)}</span>
        : item.kind === "session" ? <span key={item.key} className="conversation-row" data-variant="compact">
          <span className="conversation-row-open"><span className="conversation-row-title"><Dot session={item.session} />{tabStatus(item.session, NO_SET) === "idle" ? <span className="conversation-row-idle" /> : null}<span>{item.session.title}</span><span className="conversation-row-age">{relativeTime(item.session.lastActivityAt, now)}</span></span></span>
        </span> : null)}
      {!sample.byTime.length ? <span className="conversation-sidebar-empty">{t("sidebarList.emptyProject")}</span> : null}
    </span></span>
    <span className="conversation-strip">
      <span className="conversation-strip-arrow"><ChevronLeft size={14} /></span>
      <span className="conversation-strip-items">{sample.strip.map(project => <span key={project.id} className="conversation-strip-project" aria-current={project.id === sample.project?.id || undefined}><Glyph project={project} size={16} /></span>)}</span>
      <span className="conversation-strip-arrow"><ChevronRight size={14} /></span>
    </span>
  </span>;
}

function Rail() {
  return <span className="sidebar-thumb-rail">
    {(["home", "inbox", "tasks", "archived", "pulls"] as const).map((id, index) => <span key={id} className="sidebar-thumb-rail-button" data-on={index === 0 || undefined}><RailGlyph id={id} active={index === 0} size={20} /></span>)}
    <span className="flex-1" />
    <span className="sidebar-thumb-rail-button"><Settings size={20} /></span>
  </span>;
}

/** The conversation area: tabs (with the project switcher when no column holds it), a message, a reply and the composer. */
function Main({ sample, switcher }: { sample: Sample; switcher: boolean }) {
  return <span className="sidebar-thumb-main">
    <span className="sidebar-thumb-header">
      {switcher ? <span className="sidebar-thumb-switcher">{sample.project ? <Glyph project={sample.project} size={14} /> : null}<span>{sample.project?.name ?? "Sirus Code"}</span><ChevronDown size={12} /></span> : null}
      <span className="sidebar-thumb-tab" data-on="">{sample.title || "Sirus Code"}</span>
      <span className="sidebar-thumb-tab" />
    </span>
    <span className="sidebar-thumb-bubble">{sample.title}</span>
    <span className="sidebar-thumb-reply"><i /><i /><i /></span>
    <span className="sidebar-thumb-composer" />
  </span>;
}

function Scene({ choice, sample }: { choice: SidebarStyleChoice; sample: Sample }) {
  const parts: Record<SidebarStyleChoice, ReactNode> = {
    rail: <><Rail /><Main sample={sample} switcher /></>,
    list: <><ListSidebar sample={sample} /><Main sample={sample} switcher={false} /></>,
    project: <><ProjectSidebar sample={sample} /><Main sample={sample} switcher={false} /></>,
    hidden: <Main sample={sample} switcher />,
  };
  return <span className="sidebar-thumb-scene" data-choice={choice} inert>{choice === "hidden" || choice === "rail" ? <Lights /> : null}{parts[choice]}</span>;
}

const CHOICES = [
  { value: "rail", label: "sidebarList.styleRail", help: "sidebarList.styleRailHelp" },
  { value: "list", label: "sidebarList.styleList", help: "sidebarList.styleListHelp" },
  { value: "project", label: "sidebarList.styleProject", help: "sidebarList.styleProjectHelp" },
  { value: "hidden", label: "sidebarList.styleHidden", help: "sidebarList.styleHiddenHelp" },
] as const satisfies readonly { value: SidebarStyleChoice; label: string; help: string }[];

/**
 * Settings → Appearance → Sidebar (ADR-139, round 2): four native radio cards, each with a
 * still miniature of the window in that style, drawn from the person's own projects and
 * conversations. Mounted only while the Appearance page shows; no animation, no IPC.
 */
export function SidebarStylePicker({ value, onChange }: { value: SidebarStyleChoice; onChange: (value: SidebarStyleChoice) => void }) {
  const t = useTranslation();
  const name = useId();
  const sample = useSample();
  const cards = useRef<HTMLFieldSetElement>(null);
  // One observer scales every scene to its card's width.
  useLayoutEffect(() => {
    const node = cards.current;
    if (!node) return;
    const measure = () => {
      const width = node.querySelector<HTMLElement>(".sidebar-thumb")?.clientWidth ?? 0;
      if (width) node.style.setProperty("--sidebar-thumb-scale", String(width / SCENE_WIDTH));
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    return () => resize.disconnect();
  }, []);
  return <fieldset ref={cards} className="sidebar-style-picker"><legend className="sr-only">{t("sidebarList.style")}</legend>
    {CHOICES.map(choice => <label key={choice.value} className="sidebar-style-option">
      <input type="radio" name={name} value={choice.value} checked={value === choice.value} onChange={() => onChange(choice.value)} />
      <span className="sidebar-thumb" aria-hidden="true"><Scene choice={choice.value} sample={sample} /></span>
      <span className="sidebar-style-label ui-control"><span className="sidebar-style-radio" />{t(choice.label)}</span>
      <span className="sidebar-style-help ui-caption">{t(choice.help)}</span>
    </label>)}
  </fieldset>;
}
