import { useEffect, useMemo, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { GitBranch } from "@/components/icons/phosphor";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/arc/popover/popover";
import { ModelIcon } from "@/components/ModelIcon";
import { ProjectGlyph } from "@/components/ProjectGlyph";
import { useTranslation } from "@/i18n/use-translation";
import { diffParts, hoverPill, HoverCardController, workspaceDiff } from "@/lib/conversation-hover";
import { environmentLabel, HOME_ENVIRONMENT } from "@/lib/environments";
import { modelDisplayName } from "@/lib/model-registry";
import { providerById } from "@/lib/provider-registry";
import { relativeTime } from "@/lib/session-board";
import { useAppStore } from "@/store/app-store";
import { useComputers } from "@/store/computers-store";

/** The row a card is for: its conversation and its element, which the card lines up with. */
interface HoverTarget { id: string; row: HTMLElement }

/**
 * The conversation list's hover card (ADR-139). One controller per list, wired to the rows'
 * container by delegated pointer events, so memoized rows never re-render for it and the
 * list itself does not re-render when the card opens, moves or closes.
 */
export function useConversationHover() {
  const [controller] = useState(() => new HoverCardController<HoverTarget>());
  const handlers = useMemo(() => {
    let hovered: HTMLElement | null = null;
    const leave = () => { if (hovered) controller.leave(hovered.dataset.conversation ?? ""); hovered = null; };
    return {
      onPointerOver: (event: ReactPointerEvent<HTMLElement>) => {
        // Touch never opens it; neither does a pointer dragging (a split drag, a selection).
        if (event.pointerType === "touch" || event.buttons !== 0 || "splitDragging" in document.documentElement.dataset) return;
        const row = (event.target as HTMLElement).closest<HTMLElement>("[data-conversation]");
        if (row === hovered) return;
        leave();
        if (!row || !event.currentTarget.contains(row)) return;
        hovered = row;
        controller.enter({ id: row.dataset.conversation ?? "", row });
      },
      onPointerLeave: leave,
      // A press opens the conversation or starts a drag: the card goes and stays away from that row.
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => controller.dismiss((event.target as HTMLElement).closest<HTMLElement>("[data-conversation]")?.dataset.conversation ?? null),
      onScroll: () => controller.dismiss(hovered?.dataset.conversation ?? null),
      onMenuOpenChange: (open: boolean) => controller.block(open),
    };
  }, [controller]);
  return { controller, ...handlers };
}

/** The one card of a list: to the right of the column, lined up with the row under the pointer. */
export function ConversationHoverCard({ controller }: { controller: HoverCardController<HoverTarget> }) {
  const target = useSyncExternalStore(controller.subscribe, controller.current, controller.current);
  // The last row keeps rendering while the card animates out; going from one row's card
  // straight to the next one's glides there instead of popping in again.
  const [previous, setPrevious] = useState(target);
  const [shown, setShown] = useState(target);
  const [glide, setGlide] = useState(false);
  if (target !== previous) {
    setPrevious(target);
    setGlide(previous !== null && target !== null);
    if (target) setShown(target);
  }
  useEffect(() => {
    if (!target) return;
    const close = () => controller.dismiss();
    window.addEventListener("blur", close);
    return () => window.removeEventListener("blur", close);
  }, [controller, target]);
  // A virtual anchor at the column's right edge, as tall as the row, so the card never covers the list.
  const anchor = useMemo(() => {
    // A row that left the list (archived, say) keeps the card where it was while it closes.
    let last: DOMRect | null = null;
    return {
      current: shown ? {
        getBoundingClientRect: () => {
          const column = shown.row.closest(".conversation-sidebar");
          if (!shown.row.isConnected || !column) return last ?? new DOMRect();
          const row = shown.row.getBoundingClientRect();
          last = DOMRect.fromRect({ x: column.getBoundingClientRect().right, y: row.top, width: 0, height: row.height });
          return last;
        },
      } : null,
    };
  }, [shown]);
  return <Popover open={target !== null} onOpenChange={(open) => { if (!open) controller.dismiss(); }}>
    <PopoverAnchor virtualRef={anchor} />
    <PopoverContent role="tooltip" side="right" align="start" sideOffset={12} collisionPadding={10} className="conversation-hover-card" data-glide={glide || undefined}
      onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}>
      {shown ? <HoverBody sessionId={shown.id} /> : null}
    </PopoverContent>
  </Popover>;
}

function HoverBody({ sessionId }: { sessionId: string }) {
  const t = useTranslation();
  const session = useAppStore((state) => state.sessions.find((item) => item.id === sessionId));
  const project = useAppStore((state) => session ? state.projects.find((item) => item.id === session.projectId) : undefined);
  const computerWaiting = useAppStore((state) => state.computer?.requests.some((request) => request.sessionId === sessionId) ?? false);
  const catalog = useAppStore((state) => session ? state.modelsByProvider[session.agent] : undefined);
  const selectedSessionId = useAppStore((state) => state.selectedSessionId);
  const changes = useAppStore((state) => state.selectedSessionId === sessionId ? state.gitStatus?.changes : null);
  const computer = useComputers((state) => {
    const item = state.computers.find((each) => each.id === state.activeId);
    if (!item) return null;
    return item.id === HOME_ENVIRONMENT ? item.label.trim() || state.hostInfo[HOME_ENVIRONMENT]?.hostName?.trim() || null : environmentLabel(item);
  });
  if (!session) return null;
  const pill = hoverPill(session, computerWaiting);
  const age = relativeTime(session.lastActivityAt);
  const rawModel = catalog?.models.find((row) => row.id === session.model)?.displayName ?? session.model;
  const model = rawModel ? modelDisplayName(session.agent, rawModel, catalog?.models.map((row) => row.displayName)) : providerById(session.agent).name;
  const totals = workspaceDiff(session, { sessionId: selectedSessionId, changes });
  const diff = diffParts(totals);
  return <>
    <p className="conversation-hover-title">{session.title}</p>
    {pill ? <span className="conversation-hover-pill" data-tone={pill}>{t(`sidebarList.hover.${pill}`)}</span> : null}
    <div className="conversation-hover-line">
      {project ? <ProjectGlyph project={project} size={13} /> : null}
      <span className="conversation-hover-grow">{project?.name}</span>
      <span className="conversation-hover-age">{age === "now" ? t("Now") : age}</span>
    </div>
    {session.worktree.branch ? <div className="conversation-hover-line">
      <GitBranch size={13} aria-hidden="true" />
      <span className="conversation-hover-grow conversation-hover-branch">{session.worktree.branch}</span>
      {diff && totals ? <span className="conversation-hover-diff" aria-label={t("project.diff", { additions: totals.additions, deletions: totals.deletions })}><span data-kind="added">{diff.added}</span><span data-kind="removed">{diff.removed}</span></span> : null}
    </div> : null}
    <div className="conversation-hover-line">
      <ModelIcon modelId={session.model ?? ""} provider={session.agent} size={13} />
      <span className="conversation-hover-grow">{computer ? `${model} · ${computer}` : model}</span>
    </div>
  </>;
}
