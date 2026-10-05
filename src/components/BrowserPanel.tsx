import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Globe,
  Link2,
  LoaderCircle,
  Plus,
  RotateCw,
  SquareDashedMousePointer,
  X,
} from "@/components/icons/phosphor";
import { client } from "@/client";
import ArcToast from "@/components/arc/toast/toast";
import { appendAttachments } from "@/lib/composer-attachments";
import { emptyComposerContext } from "@/lib/composer-context";
import { browserAddressDisplayValue, normalizeBrowserAddressInput } from "@/lib/browser-url";
import { cn } from "@/lib/cn";
import { formatUnknownError } from "@/lib/format-error";
import { useBrowserBounds } from "@/lib/use-browser-bounds";
import { useTranslation } from "@/i18n/use-translation";
import { useAppStore } from "@/store/app-store";
import type { BrowserAnnotation, BrowserTabState } from "@/client/types";

// Zustand/React require a stable snapshot even before these session lists exist.
const EMPTY_URLS: string[] = [];

function isBlankBrowserUrl(url: string) {
  return !url || url === "about:blank";
}

function TabFavicon({ tab }: { tab: BrowserTabState }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [tab.faviconUrl]);
  if (tab.loading) return <LoaderCircle size={12} aria-hidden="true" className="shrink-0 animate-spin text-text-muted" />;
  if (tab.faviconUrl && !failed) {
    return <img src={tab.faviconUrl} alt="" width={13} height={13} className="size-[13px] shrink-0 rounded-[3px] object-contain"
      onError={() => setFailed(true)} />;
  }
  return <Globe size={12} aria-hidden="true" className="shrink-0 text-text-muted" />;
}

/** Per-session native browser: toolbar, tabs and the measured viewport the WKWebView covers. */
export function BrowserPanel({ sessionId }: { sessionId: string }) {
  const t = useTranslation();
  const browser = useAppStore((state) => state.browserBySession[sessionId]);
  const history = useAppStore((state) => state.browserHistoryBySession[sessionId] ?? EMPTY_URLS);
  const servers = useAppStore((state) => state.localServersBySession[sessionId] ?? EMPTY_URLS);
  const openBrowser = useAppStore((state) => state.openBrowser);
  const browserNewTab = useAppStore((state) => state.browserNewTab);
  const browserCloseTab = useAppStore((state) => state.browserCloseTab);
  const browserSelectTab = useAppStore((state) => state.browserSelectTab);
  const browserNavigate = useAppStore((state) => state.browserNavigate);
  const browserReload = useAppStore((state) => state.browserReload);
  const browserBack = useAppStore((state) => state.browserBack);
  const browserForward = useAppStore((state) => state.browserForward);
  const browserAnnotateStart = useAppStore((state) => state.browserAnnotateStart);
  const browserAnnotateFinish = useAppStore((state) => state.browserAnnotateFinish);
  const browserAnnotateCancel = useAppStore((state) => state.browserAnnotateCancel);
  const browserCopyLink = useAppStore((state) => state.browserCopyLink);
  const browserCapture = useAppStore((state) => state.browserCapture);
  const noteBrowserUrl = useAppStore((state) => state.noteBrowserUrl);
  const [address, setAddress] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const annotatingRef = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);
  const attempted = useRef<string | null>(null);
  const active = browser?.tabs.find((tab) => tab.id === browser.activeTabId) ?? null;
  const activeTabId = active?.id ?? null;
  const blank = !active || isBlankBrowserUrl(active.url);

  useEffect(() => {
    if (browser?.open || attempted.current === sessionId) return;
    attempted.current = sessionId;
    void openBrowser(sessionId);
  }, [sessionId, browser?.open, openBrowser]);

  useEffect(() => {
    setAddress(browserAddressDisplayValue(active?.url ?? ""));
  }, [active?.id, active?.url]);

  useEffect(() => {
    if (active && !isBlankBrowserUrl(active.url)) noteBrowserUrl(sessionId, active.url);
  }, [sessionId, active?.url, active, noteBrowserUrl]);

  useEffect(() => {
    return () => {
      if (activeTabId && annotatingRef.current) void browserAnnotateCancel(sessionId, activeTabId);
      annotatingRef.current = false;
    };
  }, [sessionId, activeTabId, browserAnnotateCancel]);

  useBrowserBounds(sessionId, viewport, Boolean(browser?.open && active && !blank));

  const suggestions = useMemo(() => {
    const query = address.trim().toLowerCase();
    const tabs = (browser?.tabs ?? []).filter((tab) => !isBlankBrowserUrl(tab.url));
    const entries: { url: string; title: string; tabId: string | null }[] = [
      ...tabs.map((tab) => ({ url: tab.url, title: tab.title, tabId: tab.id })),
      ...history.filter((url) => !tabs.some((tab) => tab.url === url)).map((url) => ({ url, title: "", tabId: null })),
    ];
    const unique = entries.filter((entry, index) => entries.findIndex((item) => item.url === entry.url) === index);
    const filtered = query
      ? unique.filter((entry) => entry.url.toLowerCase().includes(query) || entry.title.toLowerCase().includes(query))
      : unique;
    return filtered.filter((entry) => entry.url !== active?.url).slice(0, 6);
  }, [address, browser?.tabs, history, active?.url]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!active) return;
    const url = normalizeBrowserAddressInput(address);
    setSuggestOpen(false);
    if (url) void browserNavigate(sessionId, active.id, url);
  };

  const appendAnnotations = (annotations: BrowserAnnotation[]) => {
    const store = useAppStore.getState();
    const key = `session:${sessionId}`;
    const current = store.composerDrafts[key] ?? "";
    const block = annotations.map((annotation) => `- ${annotation.label} — ${annotation.selector}`).join("\n");
    store.setComposerDraft(key, current.trim() ? `${current.replace(/\s+$/, "")}\n${block}` : block);
  };

  const toggleAnnotate = async () => {
    if (!active) return;
    if (!annotating) {
      if (await browserAnnotateStart(sessionId, active.id)) {
        annotatingRef.current = true;
        setAnnotating(true);
      }
      return;
    }
    annotatingRef.current = false;
    setAnnotating(false);
    const annotations = await browserAnnotateFinish(sessionId, active.id);
    if (annotations?.length) appendAnnotations(annotations);
  };

  const captureToComposer = async () => {
    if (!active || blank) return;
    const png = await browserCapture(sessionId, active.id);
    if (!png) return;
    try {
      const owner = `session:${sessionId}`;
      const [attachment] = await client.pastePromptAttachments(owner, [{ name: `browser-${Date.now()}.png`, data: png }]);
      if (!attachment) return;
      const store = useAppStore.getState();
      const context = store.composerContexts[owner] ?? emptyComposerContext;
      store.setComposerContext(owner, { ...context, attachments: appendAttachments(context.attachments, [attachment]) });
    } catch (error) {
      useAppStore.setState({ error: formatUnknownError(error) });
    }
  };

  const copyLink = async () => {
    if (!active || blank) return;
    if (await browserCopyLink(sessionId, active.id)) setNotice("Link copied");
  };

  const controlClass = "inline-flex size-6 shrink-0 items-center justify-center rounded-[7px] text-text-muted transition-colors duration-[var(--motion-fast)] hover:bg-background-3/80 hover:text-text-primary disabled:opacity-40";

  return <div className="relative flex h-full min-h-0 flex-col">
    <div className="flex items-center gap-1 px-2 pt-2">
      <button type="button" title={t("Back")} aria-label={t("Back")} disabled={!active?.canGoBack} onClick={() => { if (active) void browserBack(sessionId, active.id); }} className={controlClass}>
        <ArrowLeft size={13} aria-hidden="true" />
      </button>
      <button type="button" title={t("Forward")} aria-label={t("Forward")} disabled={!active?.canGoForward} onClick={() => { if (active) void browserForward(sessionId, active.id); }} className={controlClass}>
        <ArrowRight size={13} aria-hidden="true" />
      </button>
      <button type="button" title={t("Reload")} aria-label={t("Reload")} disabled={!active} onClick={() => { if (active) void browserReload(sessionId, active.id); }} className={controlClass}>
        <RotateCw size={13} aria-hidden="true" />
      </button>
      <div className="relative mx-1 min-w-0 flex-1">
        <form onSubmit={submit} className="flex h-7 min-w-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-border-default bg-background-1 px-2 transition-colors duration-[var(--motion-fast)] focus-within:border-text-muted">
          {active?.loading ? <LoaderCircle size={12} aria-hidden="true" className="shrink-0 animate-spin text-text-muted" /> : null}
          <input value={address} onChange={(event) => { setAddress(event.target.value); setSuggestOpen(true); }} onFocus={() => setSuggestOpen(true)} onBlur={() => setSuggestOpen(false)}
            placeholder={t("Search or enter a URL")} aria-label={t("Address")} disabled={!browser?.open}
            onKeyDown={(event) => { if (event.key === "Escape" && suggestOpen) { event.preventDefault(); setSuggestOpen(false); } }}
            className="h-full min-w-0 flex-1 border-0 bg-transparent ui-control text-text-primary outline-none placeholder:text-text-muted focus-visible:outline-none disabled:opacity-50" />
        </form>
        {suggestOpen && suggestions.length > 0 ? <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-[8px] border border-border-subtle bg-background-2 py-1 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
          {suggestions.map((entry) => <button key={entry.url} type="button" onMouseDown={(event) => event.preventDefault()}
            onClick={() => { setSuggestOpen(false); if (entry.tabId) void browserSelectTab(sessionId, entry.tabId); else if (active) void browserNavigate(sessionId, active.id, entry.url); }}
            className="flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left hover:bg-background-3">
            <span className="w-full truncate ui-control text-text-primary">{entry.title || entry.url}</span>
            {entry.title ? <span className="w-full truncate ui-caption text-text-muted">{entry.url}</span> : null}
          </button>)}
        </div> : null}
      </div>
      <button type="button" title={t("Copy link")} aria-label={t("Copy link")} disabled={!active || blank} onClick={() => void copyLink()} className={controlClass}>
        <Link2 size={13} aria-hidden="true" />
      </button>
      <button type="button" title={t("Capture screenshot")} aria-label={t("Capture screenshot")} disabled={!active || blank} onClick={() => void captureToComposer()} className={controlClass}>
        <Camera size={13} aria-hidden="true" />
      </button>
      <button type="button" title={t(annotating ? "Finish annotation" : "Annotate element")} aria-label={t(annotating ? "Finish annotation" : "Annotate element")} aria-pressed={annotating} disabled={!active || blank}
        onClick={() => void toggleAnnotate()} className={cn(controlClass, annotating && "bg-background-3 text-text-primary")}>
        <SquareDashedMousePointer size={13} aria-hidden="true" />
      </button>
    </div>
    {browser && browser.tabs.length > 0 ? <div role="tablist" aria-label={t("Browser")} className="scroll-thin mt-1.5 flex items-center gap-1 overflow-x-auto px-2 pb-0.5">
      {browser.tabs.map((tab) => {
        const selected = tab.id === browser.activeTabId;
        return <div key={tab.id} role="tab" aria-selected={selected} tabIndex={0}
          onClick={() => void browserSelectTab(sessionId, tab.id)}
          onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); void browserCloseTab(sessionId, tab.id); } }}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void browserSelectTab(sessionId, tab.id); } }}
          className={cn("group flex h-7 min-w-0 max-w-[132px] flex-none cursor-pointer items-center gap-1.5 rounded-[10px] border px-2 transition-colors duration-[var(--motion-fast)]",
            selected ? "border-border-subtle bg-background-2 text-text-primary" : "border-transparent text-text-secondary hover:bg-background-2/60")}>
          <TabFavicon tab={tab} />
          <span className="min-w-0 flex-1 truncate ui-caption">{tab.title || t("New tab")}</span>
          <button type="button" title={t("Close tab")} aria-label={t("Close tab")} onClick={(event) => { event.stopPropagation(); void browserCloseTab(sessionId, tab.id); }}
            className="flex size-4 shrink-0 items-center justify-center rounded text-text-muted hover:text-text-primary"><X size={11} aria-hidden="true" /></button>
        </div>;
      })}
      <button type="button" title={t("New tab")} aria-label={t("New tab")} disabled={!browser.open} onClick={() => void browserNewTab(sessionId)}
        className={cn(controlClass, "ml-0.5")}><Plus size={13} aria-hidden="true" /></button>
    </div> : null}
    <div ref={viewport} className="relative mt-1 min-h-0 flex-1">
      {!browser || browser.tabs.length === 0 ? <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-text-muted">
        <Globe size={20} aria-hidden="true" />
        <p className="ui-control">{t("No tabs open")}</p>
        <button type="button" onClick={() => void browserNewTab(sessionId)} disabled={!browser?.open}
          className="rounded-[8px] px-2 py-1 ui-control text-text-secondary hover:bg-background-3 hover:text-text-primary disabled:opacity-50">{t("New tab")}</button>
      </div> : blank ? <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <Globe size={20} aria-hidden="true" className="text-text-muted" />
        {servers.length > 0 ? <>
          <p className="ui-control text-text-secondary">{t("Local servers")}</p>
          <div className="flex w-full max-w-[320px] flex-col gap-1">
            {servers.map((url) => <button key={url} type="button" onClick={() => { if (active) void browserNavigate(sessionId, active.id, url); }}
              className="truncate rounded-[8px] px-2 py-1.5 ui-control text-text-secondary hover:bg-background-3 hover:text-text-primary">{url}</button>)}
          </div>
        </> : <p className="ui-control text-text-secondary">{t("Start a new page")}</p>}
      </div> : null}
    </div>
    {notice ? <div className="pointer-events-none absolute left-1/2 top-1.5 z-50 w-[min(320px,80%)] -translate-x-1/2">
      <ArcToast key={notice} variant="success" title={t(notice)} duration={1600} dismissLabel={t("common.dismiss")} onOpenChange={(open) => { if (!open) setNotice(null); }} />
    </div> : null}
  </div>;
}
