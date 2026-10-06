import { useRef, useState, type ReactNode } from "react";
import { PopoverAnchor } from "@radix-ui/react-popover";
import { Check, Clock3, Ellipsis, GitPullRequest, GripVertical, Inbox, ListTodo, SlidersHorizontal } from "@/components/icons/phosphor";
import { SidebarNavigationIcon } from "@/components/icons/SidebarNavigationIcon";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";
import { moveRailItem, RAIL_LABELS, railOrder, type RailItem } from "@/lib/rail";
import { usePointerReorder } from "@/lib/use-pointer-reorder";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/primitives/Dropdown";
import { Popover, PopoverContent } from "@/primitives/Popover";
import { useAppStore } from "@/store/app-store";

/** The glyph each rail item shows (filled when it is the current page). */
export function RailGlyph({ id, active = false, size = 20 }: { id: RailItem; active?: boolean; size?: number }): ReactNode {
  const fill = active ? "currentColor" : "none";
  switch (id) {
    case "home": case "kanban": case "archived": return <SidebarNavigationIcon section={id} filled={active} size={size} />;
    case "inbox": return <Inbox size={size} fill={fill} />;
    case "tasks": return <ListTodo size={size} fill={fill} />;
    case "pulls": return <GitPullRequest size={size} fill={fill} />;
    case "automations": return <Clock3 size={size} fill={fill} />;
  }
}

/**
 * Rail "more" menu (ADR-052): projects pinned as rail shortcuts and the
 * Customize list (visibility and drag/keyboard reorder). Saved in AppSettings.
 */
export function SidebarRailMore({ onOpen }: { onOpen: () => void }) {
  const t = useTranslation();
  const projects = useAppStore((state) => state.projects);
  const settings = useAppStore((state) => state.settings);
  const [customizing, setCustomizing] = useState(false);
  // Customize opens after the menu has closed and returned focus, or that focus change would dismiss it.
  const pendingCustomize = useRef(false);
  const order = railOrder(settings.railItemOrder);
  const save = (patch: Partial<typeof settings>) => { const store = useAppStore.getState(); void store.saveSettings({ ...store.settings, ...patch }); };
  const toggleShortcut = (id: string) => {
    const current = useAppStore.getState().settings.railProjectShortcuts;
    save({ railProjectShortcuts: current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(0, 12) });
  };
  const toggleHidden = (id: RailItem) => {
    if (id === "home") return;
    const hidden = useAppStore.getState().settings.hiddenRailItems;
    save({ hiddenRailItems: hidden.includes(id) ? hidden.filter((item) => item !== id) : [...hidden, id] });
  };
  const move = (id: RailItem, to: number) => save({ railItemOrder: moveRailItem(railOrder(useAppStore.getState().settings.railItemOrder), id, to) });
  const reorder = usePointerReorder({ onDrop: (source, target, edge) => {
    const current = railOrder(useAppStore.getState().settings.railItemOrder).filter((item) => item !== source);
    const index = current.indexOf(target as RailItem) + (edge === "after" ? 1 : 0);
    move(source as RailItem, index);
  } });

  return <Popover open={customizing} onOpenChange={setCustomizing}>
    <Dropdown onOpenChange={(open) => { if (open) onOpen(); }}>
      <PopoverAnchor asChild>
        <DropdownTrigger asChild>
          <button type="button" className="sidebar-rail-button" data-section="more" aria-label={t("rail.more")} title={t("rail.more")}><Ellipsis size={20} /></button>
        </DropdownTrigger>
      </PopoverAnchor>
      <DropdownContent side="right" align="start" sideOffset={10} className="min-w-[230px]" onCloseAutoFocus={(event) => { if (!pendingCustomize.current) return; event.preventDefault(); pendingCustomize.current = false; requestAnimationFrame(() => setCustomizing(true)); }}>
        <p className="px-2 py-1 ui-caption text-text-muted">{t("rail.projects")}</p>
        {projects.length === 0 ? <p className="px-2 py-1 ui-caption text-text-muted">{t("rail.noProjects")}</p> : null}
        {projects.map((project) => <DropdownItem key={project.id} onSelect={(event) => { event.preventDefault(); toggleShortcut(project.id); }}>
          <span className="flex min-w-[190px] items-center gap-2"><span className="min-w-0 flex-1 truncate">{project.name}</span>{settings.railProjectShortcuts.includes(project.id) ? <Check size={13} /> : <span className="w-[13px]" />}</span>
        </DropdownItem>)}
        <DropdownSeparator />
        <DropdownItem icon={<SlidersHorizontal size={15} />} onSelect={() => { pendingCustomize.current = true; }}>{t("rail.customize")}</DropdownItem>
      </DropdownContent>
    </Dropdown>
    <PopoverContent side="right" align="start" sideOffset={10} className="sidebar-customize w-[280px] p-2" aria-label={t("rail.customizeTitle")}>
      <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
        <p className="ui-caption text-text-muted">{t("rail.customizeTitle")}</p>
        <button type="button" className="rounded-[6px] px-2 py-0.5 ui-control text-text-primary hover:bg-background-3" onClick={() => setCustomizing(false)}>{t("rail.done")}</button>
      </div>
      <ul className="flex flex-col gap-0.5" data-reorder-scope="" aria-label={t("rail.customizeTitle")}>
        {order.map((id, index) => {
          const hidden = settings.hiddenRailItems.includes(id);
          return <li key={id} {...reorder.bind(id)} className={cn("sidebar-customize-row", reorder.dragging === id && "opacity-50", reorder.over?.id === id && `sidebar-customize-drop-${reorder.over.edge}`)}>
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
              <input type="checkbox" className="sidebar-customize-check" checked={!hidden} disabled={id === "home"} aria-label={t(RAIL_LABELS[id])}
                onChange={() => toggleHidden(id)}
                onKeyDown={(event) => {
                  if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
                  event.preventDefault();
                  move(id, index + (event.key === "ArrowUp" ? -1 : 1));
                }} />
              <span className="flex size-5 shrink-0 items-center justify-center text-text-secondary"><RailGlyph id={id} size={16} /></span>
              <span className="truncate ui-control text-text-primary">{t(RAIL_LABELS[id])}</span>
            </label>
            <span className="sidebar-customize-grip" aria-hidden="true" title={t("rail.dragHint")}><GripVertical size={14} /></span>
          </li>;
        })}
      </ul>
      <p className="px-2 pb-1 pt-2 ui-caption text-text-muted">{t("rail.reorderHint")}</p>
    </PopoverContent>
  </Popover>;
}
