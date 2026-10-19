import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { client } from "@/client";
import type { MessageVisual } from "@/client/types";
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { openLink } from "@/components/ChatMarkdown";
import { useTranslation } from "@/i18n/use-translation";
import { buildVisualDocument, clampVisualHeight, readVisualMessage, readVisualTheme, VISUAL_INITIAL_HEIGHT, visualThemeMessage, type VisualTheme } from "@/lib/inline-visual";

/** A visual may open one link per this interval, and only while the person is in it. */
const LINK_INTERVAL_MS = 1000;

function currentTheme(): VisualTheme {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  return readVisualTheme((name) => style.getPropertyValue(name), root.dataset.theme === "light" ? "light" : "dark");
}

/** Follows the app theme (palette, font, size) while a visual is mounted. */
function useVisualTheme(): VisualTheme {
  const [theme, setTheme] = useState(currentTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme((previous) => {
      const next = currentTheme();
      return JSON.stringify(next) === JSON.stringify(previous) ? previous : next;
    }));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

function scrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/** The visuals an agent published into its reply with `sirus_show_visual` (ADR-123). */
export function InlineVisuals({ visuals }: { visuals: MessageVisual[] }) {
  return <div className="inline-visuals">{visuals.map((visual) => <InlineVisual key={visual.id} visual={visual} />)}</div>;
}

const InlineVisual = memo(function InlineVisual({ visual }: { visual: MessageVisual }) {
  const t = useTranslation();
  return <figure className="inline-visual" aria-label={visual.title}>
    <figcaption className="inline-visual-bar">
      <span className="inline-visual-title ui-caption" title={visual.title}>{visual.title}</span>
      <CopyButton value={visual.html} label={t("visual.copySource")} iconOnly variant="plain" className="size-6 min-h-0 text-text-muted [&_svg]:size-[13px]" />
    </figcaption>
    {/* A new revision mounts a fresh frame; theme changes reach the mounted one as messages. */}
    <VisualFrame key={`${visual.id}:${visual.revision}`} html={visual.html} title={visual.title} />
  </figure>;
}, (a, b) => a.visual.id === b.visual.id && a.visual.revision === b.visual.revision && a.visual.title === b.visual.title);

function VisualFrame({ html, title }: { html: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const theme = useVisualTheme();
  // Built once with the theme of that moment: a new document would reload the page.
  const [source] = useState(() => buildVisualDocument(html, theme));
  const [id, setId] = useState<string | null>(null);
  const [height, setHeight] = useState(VISUAL_INITIAL_HEIGHT);
  const lastLink = useRef(0);

  useEffect(() => {
    let alive = true;
    client.htmlPreview(source).then((value) => { if (alive) setId(value); }, () => undefined);
    return () => { alive = false; };
  }, [source]);

  const themeRef = useRef(theme);
  const sendTheme = () => frame.current?.contentWindow?.postMessage(visualThemeMessage(themeRef.current), "*");
  useEffect(() => {
    themeRef.current = theme;
    sendTheme();
  }, [theme]);

  // Registered with the frame, before a fast page posts its first height.
  useLayoutEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const element = frame.current;
      // The page's origin is opaque: its window is the only way to know a message is its own.
      if (!element || !event.source || event.source !== element.contentWindow) return;
      const message = readVisualMessage(event.data);
      if (!message) return;
      if (message.type === "height") setHeight(clampVisualHeight(message.height));
      else if (message.type === "wheel") {
        // Tell the transcript this scroll is the reader's (an untrusted wheel event never scrolls).
        element.dispatchEvent(new WheelEvent("wheel", { deltaY: message.dy, bubbles: true }));
        scrollParent(element)?.scrollBy({ left: 0, top: message.dy });
      }
      else if (message.type === "link") {
        // Only after the person clicked into the visual, and never in a burst.
        const now = Date.now();
        if (document.activeElement !== element || now - lastLink.current < LINK_INTERVAL_MS) return;
        lastLink.current = now;
        openLink(message.url, true);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // The same color scheme as the page keeps the frame's canvas transparent.
  const style = { height, colorScheme: theme.scheme };
  return id
    ? <iframe ref={frame} title={title} src={`sirus-preview://localhost/v/${id}`} sandbox="allow-scripts" referrerPolicy="no-referrer" className="inline-visual-frame" style={style} onLoad={sendTheme} />
    : <div className="inline-visual-frame" style={style} aria-busy="true" />;
}
