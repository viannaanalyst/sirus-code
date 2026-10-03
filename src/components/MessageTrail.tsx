import { memo, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Tooltip } from "@/components/arc/tooltip/tooltip";
import { deriveMessageTrail, observeMessageTrail, type MessageTrailPosition } from "@/lib/message-trail";
import { useTranslation } from "@/i18n/use-translation";
import type { Message } from "@/client/types";

interface Props {
  messages: readonly Message[];
  viewport: RefObject<HTMLDivElement | null>;
  content: RefObject<HTMLDivElement | null>;
  nodes: RefObject<Map<string, HTMLElement>>;
  onSelect: (messageId: string) => void;
}

export const MessageTrail = memo(function MessageTrail({ messages, viewport, content, nodes, onSelect }: Props) {
  const t = useTranslation();
  const items = useMemo(() => deriveMessageTrail(messages), [messages]);
  const ids = items.map(item => item.id).join("\0");
  const rail = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [position, setPosition] = useState<MessageTrailPosition>({ currentId: null, visibleIds: [] });
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [tabStop, setTabStop] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!viewport.current || !content.current) return;
    return observeMessageTrail(viewport.current, content.current, ids ? ids.split("\0") : [], nodes.current, setPosition);
  }, [viewport, content, nodes, ids]);

  useLayoutEffect(() => {
    // Scroll only the small rail, never the transcript or its ancestors.
    if (hovered || focused || !position.currentId) return;
    const box = rail.current, button = buttons.current.get(position.currentId);
    if (!box || !button) return;
    const top = button.offsetTop, bottom = top + button.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
  }, [position.currentId, hovered, focused]);

  if (items.length < 2) return null;
  const selected = items.some(item => item.id === tabStop) ? tabStop : position.currentId ?? items[0].id;
  const focusedIndex = items.findIndex(item => item.id === (hovered ?? focused));
  const visible = new Set(position.visibleIds);
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "ArrowDown" ? Math.min(items.length - 1, index + 1)
      : event.key === "ArrowUp" ? Math.max(0, index - 1)
      : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const id = items[next].id;
    setTabStop(id);
    const button = buttons.current.get(id);
    button?.focus({ preventScroll: true });
    const box = rail.current;
    if (button && box) {
      if (button.offsetTop < box.scrollTop) box.scrollTop = button.offsetTop;
      else if (button.offsetTop + button.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = button.offsetTop + button.offsetHeight - box.clientHeight;
    }
  };

  return <nav aria-label={t("session.messageNavigation")} className="message-trail absolute inset-y-0 left-0 z-20 w-12 flex-col justify-center">
    <div ref={rail} className="transcript-scroll relative max-h-[80%] overflow-y-auto overscroll-contain py-2" onPointerLeave={() => setHovered(null)}>
      {items.map((item, index) => {
        const emphasis = focusedIndex < 0 ? 0 : Math.exp(-((index - focusedIndex) ** 2) / 4.5);
        const current = item.id === position.currentId;
        const preview = item.preview || t("session.messageWithoutText");
        return <Tooltip key={item.id} side="right" content={<div className="w-56 max-w-[calc(100vw-6rem)] whitespace-normal text-left ui-control"><p className="line-clamp-2 font-medium text-text-primary">{preview}</p>{item.responsePreview ? <p className="mt-1 line-clamp-3 text-text-muted">{item.responsePreview}</p> : null}</div>}>
          <button ref={node => { if (node) buttons.current.set(item.id, node); else buttons.current.delete(item.id); }} type="button"
            data-trail-message={item.id} aria-label={t("session.messageNavigationItem", { number: item.ordinal, preview: preview.slice(0, 80) })}
            aria-current={current ? "location" : undefined} tabIndex={item.id === selected ? 0 : -1}
            onPointerEnter={() => setHovered(item.id)}
            onFocus={() => { setFocused(item.id); setTabStop(item.id); }} onBlur={() => setFocused(null)}
            onKeyDown={event => move(event, index)} onClick={() => { setHovered(null); onSelect(item.id); }}
            className="group/trail flex h-3 w-full items-center pl-3 text-text-primary outline-none focus-visible:rounded-[4px] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
            <span aria-hidden="true" className="block h-0.5 rounded-full motion-safe:transition-[width,opacity] motion-safe:duration-[var(--motion-fast)]" style={{ width: `${(current ? 12 : 6) + emphasis * (30 - (current ? 12 : 6))}px`, opacity: index === focusedIndex ? 1 : current ? 0.9 : visible.has(item.id) ? 0.5 : 0.25, backgroundColor: "currentColor" }} />
          </button>
        </Tooltip>;
      })}
    </div>
  </nav>;
});
