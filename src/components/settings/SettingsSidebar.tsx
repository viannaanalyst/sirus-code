import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "@/i18n/use-translation";
import { useGlidingHover } from "@/lib/use-gliding-hover";
import {
  ArrowLeft,
  Bell,
  Box,
  FolderGit2,
  GitBranch,
  Keyboard,
  MessageSquare,
  Monitor,
  MousePointerClick,
  Plug,
  Puzzle,
  Settings2,
  SlidersHorizontal,
  Smartphone,
  TerminalSquare,
  Search,
  X,
} from "@/components/icons/phosphor";
import { isRemoteUi } from "@/client";
import { cn } from "@/lib/cn";
import { cascadeIndex, useCascade } from "@/lib/cascade";
import type { SettingsSectionId } from "@/lib/settings";
import "@/styles/general-settings.css";

export const SETTINGS_GROUPS: { label: string; items: { id: SettingsSectionId; label: string; icon: typeof Settings2 }[] }[] = [
  {
    label: "Personal",
    items: [
      { id: "general", label: "General", icon: Settings2 },
      { id: "chat", label: "chatBehavior.title", icon: MessageSquare },
      { id: "appearance", label: "Appearance", icon: Monitor },
      { id: "notifications", label: "Notifications", icon: Bell },
      { id: "keybindings", label: "Keybindings", icon: Keyboard },
    ],
  },
  {
    label: "Coding",
    items: [
      { id: "providers", label: "Providers", icon: Puzzle },
      { id: "skills", label: "skills.title", icon: Box },
      { id: "mcp", label: "mcp.title", icon: Plug },
      { id: "computer", label: "computer.title", icon: MousePointerClick },
      { id: "git", label: "Git", icon: GitBranch },
      { id: "worktrees", label: "Worktrees", icon: FolderGit2 },
      { id: "terminal", label: "Terminal", icon: TerminalSquare },
    ],
  },
  {
    label: "System",
    items: [
      // Remote access is managed only at the Mac (ADR-080).
      { id: "connections", label: "connections.title", icon: Smartphone },
      { id: "advanced", label: "Advanced", icon: SlidersHorizontal },
    ],
  },
];

export function SettingsSidebar({
  section,
  onSection,
  onBack,
  query,
  onQuery,
  matched,
}: {
  section: SettingsSectionId;
  onSection: (id: SettingsSectionId) => void;
  onBack: () => void;
  query: string;
  onQuery: (query: string) => void;
  /** Pages with search results; others dim while searching. */
  matched: ReadonlySet<SettingsSectionId> | null;
}) {
  const t = useTranslation();
  const list = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const navGlide = useGlidingHover(".sidebar-menu-row");
  // The menu cascades in when Settings opens or its dock reopens (it mounts then), never on a page switch (ADR-096).
  const cascade = useCascade();
  let row = 0;
  // One selection highlight glides between menu items; the first placement and resizes are instant.
  useLayoutEffect(() => {
    const box = list.current, mark = indicator.current;
    if (!box || !mark) return;
    const place = (instant: boolean) => {
      const item = box.querySelector<HTMLElement>('[aria-current="page"]');
      mark.toggleAttribute("data-visible", !!item);
      if (!item) return;
      mark.toggleAttribute("data-instant", instant);
      const outer = box.getBoundingClientRect(), rect = item.getBoundingClientRect();
      mark.style.transform = `translate(${rect.left - outer.left + box.scrollLeft}px, ${rect.top - outer.top + box.scrollTop}px)`;
      mark.style.width = `${rect.width}px`;
      mark.style.height = `${rect.height}px`;
    };
    place(!placed.current);
    placed.current = true;
    // ResizeObserver reports once on observe; only later size changes (font scale, window) re-place.
    let initial = true;
    const observer = new ResizeObserver(() => { if (initial) initial = false; else place(true); });
    observer.observe(box);
    return () => observer.disconnect();
  }, [section]);
  return (
    <nav className="sidebar-material flex h-full w-[256px] shrink-0 flex-col border-r border-border-subtle bg-background-1 max-md:h-auto max-md:w-full max-md:border-b max-md:border-r-0">
      <div className="titlebar-drag h-[var(--window-controls-height)] shrink-0" />
      <div ref={list} {...navGlide.handlers} data-cascade={cascade ? "" : undefined} className="settings-nav glide-hover-host titlebar-no-drag relative isolate flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pt-1.5 pb-3">
        {navGlide.pill}
        <span ref={indicator} aria-hidden="true" className="settings-nav-indicator" />
        <button type="button" data-settings-back data-cascade-item="" style={cascadeIndex(row++)} onClick={onBack}
          className="sidebar-menu-row mb-3 flex w-full shrink-0 items-center gap-2.5 px-2.5 text-left ui-body text-text-primary">
          <ArrowLeft size={16} aria-hidden="true" className="shrink-0 text-text-secondary" />
          <span className="truncate">{t("Back to app")}</span>
        </button>
        <label className="settings-search">
          <Search size={14} aria-hidden="true" />
          <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={t("settingsSearch.placeholder")} aria-label={t("settingsSearch.placeholder")}
            onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); onQuery(""); } }} />
          {query ? <button type="button" aria-label={t("settingsSearch.clear")} onClick={() => onQuery("")}><X size={12} aria-hidden="true" /></button> : null}
        </label>
        {SETTINGS_GROUPS.map((group, index) => (
          <div key={group.label}>
            <p data-cascade-item="" style={cascadeIndex(row++)} className={cn("mb-1 px-2.5 ui-caption text-text-muted", index === 0 ? "mt-1" : "mt-4")}>{t(group.label)}</p>
            {group.items.filter((item) => !(isRemoteUi && item.id === "connections")).map((item) => {
              const Icon = item.icon;
              const active = item.id === section;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active && !matched ? "page" : undefined}
                  data-dim={matched && !matched.has(item.id) ? "" : undefined}
                  data-cascade-item=""
                  style={cascadeIndex(row++)}
                  onClick={() => onSection(item.id)}
                  className={cn(
                    "sidebar-menu-row mb-0.5 flex w-full items-center gap-2.5 px-2.5 ui-control",
                    active ? "text-text-primary" : "text-text-secondary",
                  )}
                >
                  <Icon size={16} className={cn("shrink-0", active ? "text-text-primary" : "text-text-muted")} />
                  {t(item.label)}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
