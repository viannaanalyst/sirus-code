import { useMemo, useRef, useState, type ComponentProps, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { GripVertical, X } from "@/components/icons/phosphor";
import { ModelIcon } from "@/components/ModelIcon";
import { SessionPane } from "@/components/SessionPane";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";
import { beginSplitDrag } from "@/lib/split-drag";
import { leafShowing, splitLeaves, splitRects, type SplitBranch, type SplitLeaf, type SplitRect } from "@/lib/split-layout";
import { useRetainedTranscripts } from "@/lib/use-retained-transcripts";
import { StatusIndicator } from "@/primitives/StatusIndicator";
import { useAppStore } from "@/store/app-store";
import "@/styles/split.css";

const percent = (value: number) => `${value * 100}%`;
const box = (rect: SplitRect): CSSProperties => ({ left: percent(rect.x), top: percent(rect.y), width: percent(rect.w), height: percent(rect.h) });

/**
 * Conversations side by side. Panes are positioned from the layout tree and
 * keyed by pane, so restructuring the tree never remounts a conversation. The
 * active pane is the selected session; the others are passive views.
 */
export function SplitWorkspace(props: ComponentProps<typeof SessionPane>) {
  const layout = useAppStore((state) => state.splitLayout);
  const leaves = splitLeaves(layout.root);
  const single = leaves.length === 1;
  const { panes, dividers } = useMemo(() => splitRects(layout.root), [layout.root]);
  const root = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState(false);
  useRetainedTranscripts(leaves.filter((leaf) => leaf.id !== layout.activeLeafId).map((leaf) => leaf.sessionId));

  return <div ref={root} data-split-root="" data-resizing={resizing || undefined} className={cn("split-root", !single && "split-root-multi")}>
    {leaves.map((leaf) => {
      const active = leaf.id === layout.activeLeafId;
      return <SplitPane key={leaf.id} leaf={leaf} active={active} single={single} style={box(panes.get(leaf.id)!)}>
        <SessionPane {...props} passive={!active} sessionId={leaf.sessionId} />
      </SplitPane>;
    })}
    {single ? null : dividers.map(({ branch, rect }) => <SplitDivider key={branch.id} branch={branch} rect={rect} root={root} onResizing={setResizing} />)}
    <SplitDropOverlay panes={panes} />
  </div>;
}

function SplitPane({ leaf, active, single, style, children }: { leaf: SplitLeaf; active: boolean; single: boolean; style: CSSProperties; children: ReactNode }) {
  // Only panes opened beside others animate in; the first one is already there.
  const [entering] = useState(!single);
  const pane = useRef<HTMLDivElement>(null);
  // Using a passive pane makes it active; its stand-in composer hands focus to the real one.
  const activate = (target: EventTarget) => {
    if (active) return;
    const toComposer = target instanceof Element && target.closest(".split-passive-composer") !== null;
    useAppStore.getState().activateSplitPane(leaf.id);
    if (toComposer) requestAnimationFrame(() => requestAnimationFrame(() => pane.current?.querySelector<HTMLTextAreaElement>("textarea[data-draft-owner]")?.focus()));
  };
  return <div ref={pane} data-split-leaf={leaf.id} className={cn("split-pane", entering && "split-pane-enter")} style={style}
    onPointerDownCapture={(event) => activate(event.target)} onFocusCapture={(event) => activate(event.target)}>
    <div className={cn("split-pane-frame", !single && "split-pane-framed", !single && active && "split-pane-active")}>
      {single ? null : <SplitPaneHeader leaf={leaf} active={active} />}
      {children}
    </div>
  </div>;
}

function SplitPaneHeader({ leaf, active }: { leaf: SplitLeaf; active: boolean }) {
  const t = useTranslation();
  const session = useAppStore((state) => leaf.sessionId ? state.sessions.find((item) => item.id === leaf.sessionId) ?? null : null);
  const title = session?.title ?? t("split.newConversation");
  return <div className="split-pane-header">
    {session ? <button type="button" className="split-pane-grip" aria-label={t("split.move", { title })} title={t("split.moveHint")}
      onPointerDown={(event) => beginSplitDrag(event, session.id, session.title)}><GripVertical size={14} /></button> : <span className="w-[22px]" />}
    {session ? <ModelIcon modelId={session.model ?? ""} provider={session.agent} size={13} /> : null}
    <span className={cn("min-w-0 flex-1 truncate ui-control", active ? "text-text-primary" : "text-text-secondary")}>{title}</span>
    {session && ["starting", "running", "waiting", "failed"].includes(session.status) ? <StatusIndicator status={session.status} /> : null}
    <button type="button" className="split-pane-close" aria-label={t("split.close", { title })} title={t("split.closeHint")}
      onPointerDown={(event) => event.stopPropagation()} onClick={() => useAppStore.getState().closeSplitPane(leaf.id)}><X size={12} /></button>
  </div>;
}

function SplitDivider({ branch, rect, root, onResizing }: { branch: SplitBranch; rect: SplitRect; root: RefObject<HTMLDivElement | null>; onResizing: (value: boolean) => void }) {
  const t = useTranslation();
  const row = branch.dir === "row";
  const at = row ? { left: percent(rect.x + rect.w * branch.ratio), top: percent(rect.y), height: percent(rect.h) } : { top: percent(rect.y + rect.h * branch.ratio), left: percent(rect.x), width: percent(rect.w) };
  const resize = (ratio: number) => useAppStore.getState().resizeSplit(branch.id, ratio);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !root.current) return;
    event.preventDefault();
    const area = root.current.getBoundingClientRect();
    const start = row ? area.left + area.width * rect.x : area.top + area.height * rect.y;
    const size = row ? area.width * rect.w : area.height * rect.h;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    onResizing(true);
    const move = (moved: PointerEvent) => resize(((row ? moved.clientX : moved.clientY) - start) / size);
    const end = () => { onResizing(false); handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", end); handle.removeEventListener("lostpointercapture", end); };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("lostpointercapture", end);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === (row ? "ArrowLeft" : "ArrowUp") ? -0.05 : event.key === (row ? "ArrowRight" : "ArrowDown") ? 0.05 : 0;
    if (!step) return;
    event.preventDefault();
    resize(branch.ratio + step);
  };
  return <div role="separator" tabIndex={0} aria-orientation={row ? "vertical" : "horizontal"} aria-label={t("split.resize")} aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(branch.ratio * 100)}
    className={cn("split-divider", row ? "split-divider-row" : "split-divider-column")} style={at} onPointerDown={onPointerDown} onKeyDown={onKeyDown} />;
}

/** Lights the half (or whole pane) where the dragged conversation would land. */
function SplitDropOverlay({ panes }: { panes: Map<string, SplitRect> }) {
  const t = useTranslation();
  const drag = useAppStore((state) => state.splitDrag);
  const layout = useAppStore((state) => state.splitLayout);
  const drop = drag?.drop;
  const base = drag && drop && drag.state !== "none" ? (drop.target === "root" ? { x: 0, y: 0, w: 1, h: 1 } : panes.get(drop.target)) : undefined;
  if (!drag || !drop || !base) return <div aria-hidden="true" className="split-drop" />;
  const rect = { ...base };
  if (drop.edge === "left" || drop.edge === "right") { rect.w /= 2; if (drop.edge === "right") rect.x += rect.w; }
  if (drop.edge === "top" || drop.edge === "bottom") { rect.h /= 2; if (drop.edge === "bottom") rect.y += rect.h; }
  const moving = leafShowing(layout, drag.sessionId) !== null;
  const label = drag.state === "full" ? t("split.full") : drop.edge === "center" ? t(moving ? "split.swap" : "split.replace") : t(`split.${drop.edge}`);
  // Hidden, the box has no position, so it appears in place and then glides between targets.
  return <div aria-hidden="true" className={cn("split-drop split-drop-visible", drag.state === "full" && "split-drop-full")} style={box(rect)}>
    <span className="split-drop-label ui-caption">{label}</span>
  </div>;
}
