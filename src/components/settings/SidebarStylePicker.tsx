import { useId, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { AppSettings, Project, Session } from "@/client/types";
import { ArrowUpDown, ChartBar, ChevronDown, FolderPlus, PanelLeft, Search, Settings, SquarePen } from "@/components/icons/phosphor";
import { ModelIcon } from "@/components/ModelIcon";
import { ProjectGlyph } from "@/components/ProjectGlyph";
import { RailGlyph } from "@/components/SidebarRailMore";
import { useTranslation } from "@/i18n/use-translation";
import { conversationListItems, type ConversationListItem, type ConversationListSettings } from "@/lib/conversation-list";
import { tabStatus } from "@/lib/header-tabs";
import { RAIL_LABELS } from "@/lib/rail";
import { relativeTime } from "@/lib/session-board";
import { selectListedSessions, useAppStore } from "@/store/app-store";
import "@/styles/sidebar.css";
import "@/styles/header-tabs.css";
import "@/styles/conversation-sidebar.css";
import "@/styles/sidebar-style-picker.css";

export type SidebarStyleChoice = AppSettings["sidebarMode"];

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
}

/** The person's own first projects and conversations, read once from the store (no IPC). */
function useSample(): Sample {
  const projects = useAppStore(state => state.projects);
  const sessions = useAppStore(selectListedSessions);
  const pinnedSessionIds = useAppStore(state => state.settings.pinnedSessionIds);
  const selectedProjectId = useAppStore(state => state.selectedProjectId);
  const selectedSessionId = useAppStore(state => state.selectedSessionId);
  return useMemo(() => {
    const settings: ConversationListSettings = { pinnedSessionIds, sidebarAttentionFirst: false, sidebarThreadSortOrder: "updated_at" };
    const project = projects.find(row => row.id === selectedProjectId) ?? projects[0] ?? null;
    const recent = conversationListItems(projects, sessions, settings, "recent").slice(0, 7);
    const current = sessions.find(row => row.id === selectedSessionId) ?? (recent[0]?.kind === "session" ? recent[0].session : null);
    return { project, title: current?.title ?? "", recent };
  }, [projects, sessions, pinnedSessionIds, selectedProjectId, selectedSessionId]);
}

function Lights() {
  return <span className="sidebar-thumb-lights"><i /><i /><i /></span>;
}

/** The column's tool rows: search, order, New project and New conversation; PRs. */
function ToolRows() {
  const t = useTranslation();
  return <>
    <span className="conversation-sidebar-tools">
      <span className="conversation-sidebar-search"><Search size={14} /><span>{t("sidebarList.search")}</span></span>
      <span className="conversation-sidebar-order"><ArrowUpDown size={15} /></span>
      <span className="conversation-sidebar-order"><FolderPlus size={15} /></span>
      <span className="conversation-sidebar-order"><SquarePen size={15} /></span>
    </span>
    <span className="conversation-sidebar-nav">
      {(["pulls"] as const).map(id => <span key={id} className="conversation-sidebar-nav-item"><RailGlyph id={id} size={14} /><span>{id === "pulls" ? t("sidebarList.pulls") : t(RAIL_LABELS[id])}</span></span>)}
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
    <ToolRows />
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
    <span className="conversation-sidebar-foot"><span className="flex-1" /><ChartBar size={17} /><Settings size={17} /></span>
  </span>;
}

function Rail() {
  return <span className="sidebar-thumb-rail">
    {(["home", "pulls"] as const).map((id, index) => <span key={id} className="sidebar-thumb-rail-button" data-on={index === 0 || undefined}><RailGlyph id={id} active={index === 0} size={20} /></span>)}
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
  };
  return <span className="sidebar-thumb-scene" data-choice={choice} inert>{choice === "rail" ? <Lights /> : null}{parts[choice]}</span>;
}

const CHOICES = [
  { value: "rail", label: "sidebarList.styleRail", help: "sidebarList.styleRailHelp" },
  { value: "list", label: "sidebarList.styleList", help: "sidebarList.styleListHelp" },
] as const satisfies readonly { value: SidebarStyleChoice; label: string; help: string }[];

/**
 * Settings → Appearance → Sidebar (ADR-139, round 2): two native radio cards, each with a
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
