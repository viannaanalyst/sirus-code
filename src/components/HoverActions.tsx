import type { PointerEvent as ReactPointerEvent } from "react";
import { GitCompareArrows, Pin, PinOff, SquarePen, SquareTerminal } from "@/components/icons";
import { useTranslation } from "@/i18n/use-translation";
import { sidebarProjectAction } from "@/lib/sidebar-actions";
import { toggleSidebarId } from "@/lib/sidebar-layout";
import { useAppStore } from "@/store/app-store";

/**
 * The buttons a project or a conversation shows while pointed at, the same in the header
 * project switcher and the conversation-list sidebar: a project offers Review changes, New
 * terminal session and New conversation; a conversation offers Pin.
 */
const stop = (event: ReactPointerEvent) => event.stopPropagation();

export const PROJECT_HOVER_ACTIONS = [
  ["review", "Review changes", GitCompareArrows],
  ["terminal", "New terminal session", SquareTerminal],
  ["new", "New thread", SquarePen],
] as const;

export function ProjectHoverActions({ projectId, className, onDone }: { projectId: string; className?: string; onDone?: () => void }) {
  const t = useTranslation();
  return <span className={className}>
    {PROJECT_HOVER_ACTIONS.map(([kind, label, Icon]) =>
      // Not real buttons inside the switcher's row button; role and keyboard come from the row's menu.
      <span key={kind} role="button" tabIndex={-1} aria-label={t(label)} title={t(label)} data-no-reorder=""
        onPointerDown={stop}
        onClick={event => { event.stopPropagation(); onDone?.(); void sidebarProjectAction(projectId, kind); }}><Icon size={13} /></span>)}
  </span>;
}

export function SessionHoverActions({ sessionId, pinned, className }: { sessionId: string; pinned: boolean; className?: string }) {
  const t = useTranslation();
  const togglePin = () => { const store = useAppStore.getState(); void store.saveSettings({ ...store.settings, pinnedSessionIds: toggleSidebarId(store.settings.pinnedSessionIds, sessionId) }); };
  return <span className={className}>
    <button type="button" aria-label={t(pinned ? "Unpin session" : "Pin session")} title={t(pinned ? "Unpin session" : "Pin session")} onPointerDown={stop}
      onClick={event => { event.stopPropagation(); togglePin(); }}>{pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>
  </span>;
}
