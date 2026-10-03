import { useRef, type MouseEvent } from "react";

/**
 * One hover highlight that glides between the items matching `selector` inside a host.
 * Render `pill` first inside the host and spread `handlers` on it; the host gets
 * `glide-hover-host`. Listeners stay on the host, never on window.
 */
export function useGlidingHover(selector: string, selected = "[aria-current='page'], [aria-expanded='true']") {
  const pill = useRef<HTMLSpanElement>(null);
  const shown = useRef(false);
  const hide = () => {
    shown.current = false;
    pill.current?.removeAttribute("data-visible");
  };
  const follow = (event: MouseEvent<HTMLElement>) => {
    const host = event.currentTarget, node = pill.current;
    const item = (event.target as Element | null)?.closest?.(selector);
    if (!node || !item || !host.contains(item)) return;
    const outer = host.getBoundingClientRect(), inner = item.getBoundingClientRect();
    // The first hover appears in place; later moves slide.
    node.toggleAttribute("data-instant", !shown.current);
    node.style.transform = `translate(${inner.left - outer.left + host.scrollLeft}px, ${inner.top - outer.top + host.scrollTop}px)`;
    node.style.width = `${inner.width}px`;
    node.style.height = `${inner.height}px`;
    // A selected item keeps its own fill; the pill fades instead of doubling it.
    node.toggleAttribute("data-on-selected", item.matches(selected));
    node.setAttribute("data-visible", "");
    shown.current = true;
  };
  return {
    pill: <span ref={pill} className="glide-hover-pill" aria-hidden="true" />,
    handlers: { onMouseOver: follow, onMouseLeave: hide, onScrollCapture: hide },
  };
}
