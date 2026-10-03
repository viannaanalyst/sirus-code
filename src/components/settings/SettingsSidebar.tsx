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
  Monitor,
  MousePointerClick,
  Puzzle,
  Settings2,
  SlidersHorizontal,
  TerminalSquare,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { SettingsSectionId } from "@/lib/settings";

const GROUPS: { label: string; items: { id: SettingsSectionId; label: string; icon: typeof Settings2 }[] }[] = [
  {
    label: "Personal",
    items: [
      { id: "general", label: "General", icon: Settings2 },
      { id: "profile", label: "Profile", icon: UserRound },
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
      { id: "computer", label: "computer.title", icon: MousePointerClick },
      { id: "git", label: "Git", icon: GitBranch },
      { id: "worktrees", label: "Worktrees", icon: FolderGit2 },
      { id: "terminal", label: "Terminal", icon: TerminalSquare },
    ],
  },
  {
    label: "System",
    items: [
      { id: "advanced", label: "Advanced", icon: SlidersHorizontal },
    ],
  },
];

export function SettingsSidebar({
  section,
  onSection,
  onBack,
}: {
  section: SettingsSectionId;
  onSection: (id: SettingsSectionId) => void;
  onBack: () => void;
}) {
  const t = useTranslation();
  const list = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const navGlide = useGlidingHover(".sidebar-menu-row");
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
      <div ref={list} {...navGlide.handlers} className="settings-nav glide-hover-host titlebar-no-drag relative isolate flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pt-1.5 pb-3">
        {navGlide.pill}
        <span ref={indicator} aria-hidden="true" className="settings-nav-indicator" />
        <button type="button" data-settings-back onClick={onBack}
          className="sidebar-menu-row mb-3 flex w-full shrink-0 items-center gap-2.5 px-2.5 text-left ui-body text-text-primary">
          <ArrowLeft size={16} aria-hidden="true" className="shrink-0 text-text-secondary" />
          <span className="truncate">{t("Back to app")}</span>
        </button>
        {GROUPS.map((group, index) => (
          <div key={group.label}>
            <p className={cn("mb-1 px-2.5 ui-caption text-text-muted", index === 0 ? "mt-1" : "mt-4")}>{t(group.label)}</p>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = item.id === section;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => onSection(item.id)}
                  className={cn(
                    "sidebar-menu-row mb-0.5 flex w-full items-center gap-2.5 px-2.5 ui-control",
                    active ? "text-text-primary" : "text-text-secondary",
                  )}
                >
                  <Icon size={15} className={active ? "text-text-primary" : "text-text-muted"} />
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
