import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, Eye, ListOrdered, Signpost, TriangleAlert, X } from "@/components/icons";
import type { ReviewGuide, ReviewGuideAnchor } from "@/client/types";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { useTranslation } from "@/i18n/use-translation";
import { motionTokens } from "@/lib/motion";
import { anchorLabel, clampStep } from "@/lib/review-guide";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/primitives/Dropdown";
import { IconButton } from "@/primitives/IconButton";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import "@/styles/review-guide.css";

type Props = {
  guide: ReviewGuide;
  step: number;
  onStep: (index: number) => void;
  anchor: number;
  onAnchor: (index: number) => void;
  /** Why an anchor cannot be shown (its file or lines are not in the diff), or null. */
  missing: (anchor: ReviewGuideAnchor) => string | null;
  stale?: boolean;
  /** The narrow layout of the Changes pane and the phone. */
  compact?: boolean;
  menu?: ReactNode;
  onClose?: () => void;
};

/**
 * One guided review (ADR-125): progress, the current step's explanation and its anchors,
 * previous and next. ← and → move between steps while focus is in the tour.
 */
export function ReviewGuideTour({ guide, step, onStep, anchor, onAnchor, missing, stale = false, compact = false, menu, onClose }: Props) {
  const t = useTranslation();
  const reduced = useMotionPreferences();
  const total = guide.steps.length;
  const index = clampStep(step, total);
  const current = guide.steps[index];
  const direction = useRef(1);
  const go = (next: number) => {
    const target = clampStep(next, total);
    if (target === index) return;
    direction.current = target > index ? 1 : -1;
    onStep(target);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return;
    if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable], [role=menu]")) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      go(index + (event.key === "ArrowRight" ? 1 : -1));
    }
  };
  if (!current) return null;
  const active = current.anchors[Math.min(anchor, current.anchors.length - 1)] ?? null;
  const problem = active ? missing(active) : null;
  const shift = reduced ? 0 : 10 * direction.current;
  return <section className="guide-tour" data-compact={compact || undefined} aria-label={t("guide.label")} onKeyDown={onKeyDown}>
    <header className="guide-tour-head">
      <span className="guide-tour-icon" aria-hidden="true"><Signpost size={15} /></span>
      <div className="min-w-0 flex-1">
        <p className="ui-micro text-text-muted">{t("guide.label")}</p>
        <h3 className="truncate ui-control font-medium text-text-primary" title={guide.title}>{guide.title}</h3>
      </div>
      <Dropdown>
        <DropdownTrigger asChild><button type="button" className="guide-tour-steps ui-caption"><ListOrdered size={13} aria-hidden="true" />{t("guide.steps")}</button></DropdownTrigger>
        <DropdownContent align="end" side="bottom" className="guide-tour-outline">
          {guide.steps.map((item, at) => <DropdownItem key={at} icon={at === index ? <Check size={14} /> : <span className="guide-tour-outline-number">{at + 1}</span>} onSelect={() => go(at)}>
            <span className="truncate">{item.title}</span>
          </DropdownItem>)}
        </DropdownContent>
      </Dropdown>
      {menu}
      {onClose ? <IconButton label={t("guide.close")} onClick={onClose} className="size-7 min-h-0"><X size={13} /></IconButton> : null}
    </header>
    <div className="guide-progress" role="group" aria-label={t("guide.steps")}>
      {guide.steps.map((item, at) => <button key={at} type="button" className="guide-progress-step" data-state={at < index ? "done" : at === index ? "current" : undefined}
        aria-current={at === index ? "step" : undefined} aria-label={t("guide.goTo", { number: at + 1, title: item.title })} title={item.title} onClick={() => go(at)} />)}
    </div>
    {stale ? <p role="status" className="guide-tour-note ui-caption"><TriangleAlert size={12} aria-hidden="true" />{t("guide.stale")}</p> : null}
    <div className="guide-tour-body" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={index} initial={{ opacity: 0, x: shift }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -shift, transition: { duration: motionTokens.instant } }}
          transition={{ duration: motionTokens.fast, ease: motionTokens.ease }}>
          <p className="ui-micro tabular-nums text-text-muted">{t("guide.step", { current: index + 1, total })}</p>
          <h4 className="mt-0.5 ui-body font-medium text-text-primary [overflow-wrap:anywhere]">{current.title}</h4>
          {index === 0 && guide.summary ? <details className="guide-tour-overview"><summary className="ui-caption text-text-muted">{t("guide.overview")}</summary><div className="mt-1 ui-body text-text-secondary"><ChatMarkdown text={guide.summary} /></div></details> : null}
          {current.attention ? <div className="guide-attention ui-caption"><Eye size={13} aria-hidden="true" /><p><strong>{t("guide.attention")}</strong> {current.attention}</p></div> : null}
          {current.body ? <div className="guide-tour-markdown ui-body text-text-secondary selectable"><ChatMarkdown text={current.body} /></div> : null}
          {current.anchors.length ? <div className="guide-anchors">
            {current.anchors.map((item, at) => {
              const label = anchorLabel(item);
              return <button key={at} type="button" className="guide-anchor ui-micro" aria-pressed={item === active} data-missing={missing(item) ? "" : undefined}
                aria-label={t("guide.showLines", { label })} title={item.caption || label} onClick={() => onAnchor(at)}>
                <span className="truncate">{label}</span>
              </button>;
            })}
          </div> : <p className="mt-2 ui-caption text-text-muted">{t("guide.noAnchors")}</p>}
          {active?.caption ? <p className="mt-1 ui-caption text-text-muted">{active.caption}</p> : null}
          {problem ? <p role="status" className="mt-1 ui-caption text-warning">{problem}</p> : null}
        </motion.div>
      </AnimatePresence>
    </div>
    <footer className="guide-tour-foot">
      <InteractiveButton variant="toolbar" disabled={index === 0} onClick={() => go(index - 1)}><ArrowLeft size={13} aria-hidden="true" />{t("guide.previous")}</InteractiveButton>
      <span className="min-w-0 flex-1 truncate text-center ui-micro text-text-muted">{compact ? null : t("guide.keys")}</span>
      <InteractiveButton variant={index === total - 1 ? "toolbar" : "secondary"} glow={false} disabled={index === total - 1} onClick={() => go(index + 1)}>{t("guide.next")}<ArrowRight size={13} aria-hidden="true" /></InteractiveButton>
    </footer>
  </section>;
}
