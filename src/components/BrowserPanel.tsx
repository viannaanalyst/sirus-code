import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Globe,
  Link2,
  LoaderCircle,
  Check,
  Code,
  Cookie,
  Eraser,
  ExternalLink,
  Monitor,
  Moon,
  MoreVertical,
  RefreshCw,
  Sun,
  ZoomIn,
  ZoomOut,
  PictureInPicture,
  Plus,
  RecordDot,
  RotateCw,
  Smartphone,
  SquareDashedMousePointer,
  X,
} from "@/components/icons";
import { LoginKeyButton, LoginOfferBar } from "@/components/BrowserLogins";
import { BrowserDeviceToolbar, BrowserViewport } from "@/components/BrowserDevice";
import { presetViewport, type DeviceViewport } from "@/lib/browser-device";
import { startRecording, stopRecording, useBrowserRecording } from "@/lib/browser-recordings";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/primitives/Dropdown";
import { client } from "@/client";
import ArcToast from "@/components/arc/toast/toast";
import { appendAttachments } from "@/lib/composer-attachments";
import { emptyComposerContext } from "@/lib/composer-context";
import { browserAddressDisplayValue, normalizeBrowserAddressInput } from "@/lib/browser-url";
import { cn } from "@/lib/cn";
import { formatUnknownError } from "@/lib/format-error";
import { useBrowserBounds } from "@/lib/use-browser-bounds";
import { useLocalServers } from "@/lib/use-local-servers";
import { annotationText, base64Text, cropAnnotationPng } from "@/lib/browser-annotation";
import { useTranslation } from "@/i18n/use-translation";
import { useAppStore } from "@/store/app-store";
import type { BrowserAnnotationCapture, BrowserDialog, BrowserProfile, BrowserSessionState, BrowserTabState } from "@/client/types";

// Zustand/React require a stable snapshot even before these session lists exist.
const EMPTY_URLS: string[] = [];
const EMPTY_PROFILES: BrowserProfile[] = [];

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
  const openBrowser = useAppStore((state) => state.openBrowser);
  const browserNewTab = useAppStore((state) => state.browserNewTab);
  const browserCloseTab = useAppStore((state) => state.browserCloseTab);
  const browserSelectTab = useAppStore((state) => state.browserSelectTab);
  const browserNavigate = useAppStore((state) => state.browserNavigate);
  const browserReload = useAppStore((state) => state.browserReload);
  const browserBack = useAppStore((state) => state.browserBack);
  const browserForward = useAppStore((state) => state.browserForward);
  const browserAnnotateStart = useAppStore((state) => state.browserAnnotateStart);
  const browserAnnotateCapture = useAppStore((state) => state.browserAnnotateCapture);
  const browserAnnotateCancel = useAppStore((state) => state.browserAnnotateCancel);
  const browserCopyLink = useAppStore((state) => state.browserCopyLink);
  const browserCapture = useAppStore((state) => state.browserCapture);
  const noteBrowserUrl = useAppStore((state) => state.noteBrowserUrl);
  const [address, setAddress] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const recording = useBrowserRecording(sessionId);
  const [pipBusy, setPipBusy] = useState(false);
  const annotatingRef = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);
  const attempted = useRef<string | null>(null);
  const active = browser?.tabs.find((tab) => tab.id === browser.activeTabId) ?? null;
  const activeTabId = active?.id ?? null;
  const blank = !active || isBlankBrowserUrl(active.url);
  const floating = Boolean(active && browser?.pictureInPicture === active.id);
  const profiles = useAppStore((state) => state.settings.browserProfiles ?? EMPTY_PROFILES);
  // Local servers are scanned only while the empty state that lists them is showing (ADR-151).
  const servers = useLocalServers(sessionId, Boolean(browser?.open) && blank);

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

  const still = useBrowserBounds(sessionId, viewport, Boolean(browser?.open && active && !blank && !floating), activeTabId);

  // Device mode lives with the native browser, so an agent's choice shows here too (ADR-112).
  const device: DeviceViewport = browser?.device ? { kind: "device", width: browser.device.width, height: browser.device.height, preset: browser.device.preset ?? null } : { kind: "fill" };
  const applyState = (state: BrowserSessionState) => useAppStore.setState((current) => ({ browserBySession: { ...current.browserBySession, [sessionId]: state } }));
  const fail = (error: unknown) => useAppStore.setState({ error: formatUnknownError(error) });
  const setDevice = (next: DeviceViewport) => {
    const value = next.kind === "fill" ? null : { width: next.width, height: next.height, preset: next.preset };
    if (browser) applyState({ ...browser, device: value });
    void client.browserSetDevice(sessionId, value).then(applyState, fail);
  };

  // A recording keeps going when the pane closes; the button or an agent ends it (ADR-112).
  const toggleRecording = async () => {
    try {
      if (recording) { await stopRecording(sessionId); return; }
      if (!active || blank) return;
      const { browserRecordingFps: fps, browserRecordingKeys: keys, browserRecordingClicks: clicks } = useAppStore.getState().settings;
      await startRecording(sessionId, active.id, { fps, keys, clicks }, (path, error) => {
        if (error) fail(error);
        else if (path) setNotice("browser.recordingSaved");
      });
    } catch (error) { fail(error); }
  };

  // The "⋮" menu (ADR-112).
  const zoom = browser?.zoom ?? 1;
  const appearance = browser?.appearance ?? "system";
  const zoomTo = (value: number) => void client.browserSetUserZoom(sessionId, value).then(applyState, fail);

  const togglePictureInPicture = async () => {
    if (!browser?.open || pipBusy) return;
    setPipBusy(true);
    try {
      const state = await client.browserPictureInPicture(sessionId, !browser.pictureInPicture);
      useAppStore.setState((current) => ({ browserBySession: { ...current.browserBySession, [sessionId]: state } }));
    } catch (error) { useAppStore.setState({ error: formatUnknownError(error) }); }
    finally { setPipBusy(false); }
  };

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

  // Annotations travel as composer attachments (ADR-151): the cropped picture of the marked
  // elements, and a text file with the page, viewport and each element's selector.
  const attachAnnotation = async (capture: BrowserAnnotationCapture) => {
    const owner = `session:${sessionId}`;
    const stamp = Date.now();
    try {
      const cropped = capture.png ? await cropAnnotationPng(capture.png, capture).catch(() => null) : null;
      const files = [
        ...(cropped ? [{ name: `annotation-${stamp}.png`, data: cropped }] : []),
        { name: `annotation-${stamp}.txt`, data: base64Text(annotationText(capture)) },
      ];
      const attachments = await client.pastePromptAttachments(owner, files);
      if (!attachments.length) return;
      const store = useAppStore.getState();
      const context = store.composerContexts[owner] ?? emptyComposerContext;
      store.setComposerContext(owner, { ...context, attachments: appendAttachments(context.attachments, attachments) });
      setNotice("browser.annotationAttached");
    } catch (error) {
      useAppStore.setState({ error: formatUnknownError(error) });
    }
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
    const capture = await browserAnnotateCapture(sessionId, active.id);
    if (!capture?.elements.length) {
      if (capture) setNotice("browser.annotationNone");
      return;
    }
    await attachAnnotation(capture);
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
      <LoginKeyButton sessionId={sessionId} url={active && !blank ? active.url : null} className={controlClass} />
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
      {/* Device mode, recording and picture in picture (ADR-111). */}
      <button type="button" title={t("browser.device")} aria-label={t("browser.device")} aria-pressed={device.kind === "device"} disabled={!active || blank || floating}
        onClick={() => setDevice(device.kind === "device" ? { kind: "fill" } : presetViewport("iphone-12-pro"))} className={cn(controlClass, device.kind === "device" && "bg-background-3 text-text-primary")}>
        <Smartphone size={13} aria-hidden="true" />
      </button>
      <button type="button" title={t(recording ? "browser.stopRecording" : "browser.record")} aria-label={t(recording ? "browser.stopRecording" : "browser.record")} aria-pressed={Boolean(recording)} disabled={!recording && (!active || blank)}
        onClick={() => void toggleRecording()} className={cn(controlClass, recording && "bg-background-3 text-danger hover:text-danger")}>
        <RecordDot size={13} aria-hidden="true" className={recording ? "animate-pulse" : undefined} />
      </button>
      <button type="button" title={t(browser?.pictureInPicture ? "browser.pipBack" : "browser.pip")} aria-label={t(browser?.pictureInPicture ? "browser.pipBack" : "browser.pip")} aria-pressed={Boolean(browser?.pictureInPicture)} disabled={pipBusy || (!browser?.pictureInPicture && (!active || blank))}
        onClick={() => void togglePictureInPicture()} className={cn(controlClass, browser?.pictureInPicture && "bg-background-3 text-text-primary")}>
        <PictureInPicture size={13} aria-hidden="true" />
      </button>
      <Dropdown>
        <DropdownTrigger asChild>
          <button type="button" title={t("browser.more")} aria-label={t("browser.more")} disabled={!browser?.open} className={controlClass}><MoreVertical size={13} aria-hidden="true" /></button>
        </DropdownTrigger>
        <DropdownContent align="end" className="min-w-[220px]">
          <DropdownItem icon={<RefreshCw size={14} />} disabled={!active || blank} onSelect={() => { if (active) void client.browserHardReload(sessionId, active.id).catch(fail); }}>{t("browser.hardReload")}</DropdownItem>
          <DropdownItem icon={<Code size={14} />} disabled={!active || blank} onSelect={() => { if (active) void client.browserDevtools(sessionId, active.id).catch(fail); }}>{t("browser.devtools")}</DropdownItem>
          <DropdownItem icon={<ExternalLink size={14} />} disabled={!active || blank} onSelect={() => { if (active) void client.openExternalUrl(active.url).catch(fail); }}>{t("browser.openSystem")}</DropdownItem>
          <DropdownSeparator />
          {(["system", "light", "dark"] as const).map((mode) => <DropdownItem key={mode} icon={mode === "system" ? <Monitor size={14} /> : mode === "light" ? <Sun size={14} /> : <Moon size={14} />}
            onSelect={() => void client.browserSetAppearance(sessionId, mode).then(applyState, fail)}>
            <span className="flex min-w-0 flex-1 items-center gap-2">{t(`browser.appearance.${mode}`)}{appearance === mode ? <Check size={13} aria-hidden="true" className="ml-auto" /> : null}</span>
          </DropdownItem>)}
          <DropdownSeparator />
          <DropdownItem icon={<ZoomIn size={14} />} disabled={zoom >= 2} onSelect={(event) => { event.preventDefault(); zoomTo(zoom + 0.1); }}>{t("browser.zoomIn")}</DropdownItem>
          <DropdownItem icon={<ZoomOut size={14} />} disabled={zoom <= 0.5} onSelect={(event) => { event.preventDefault(); zoomTo(zoom - 0.1); }}>{t("browser.zoomOut")}</DropdownItem>
          <DropdownItem icon={<span />} disabled={zoom === 1} onSelect={() => zoomTo(1)}><span className="flex items-center gap-3">{t("browser.zoomReset")}<span className="ui-micro tabular-nums text-text-muted">{Math.round(zoom * 100)}%</span></span></DropdownItem>
          <DropdownSeparator />
          <DropdownItem icon={<Cookie size={14} />} onSelect={() => void client.browserClearData("cookies").then(() => setNotice("browser.cookiesCleared"), fail)}>{t("browser.clearCookies")}</DropdownItem>
          <DropdownItem icon={<Eraser size={14} />} onSelect={() => void client.browserClearData("cache").then(() => setNotice("browser.cacheCleared"), fail)}>{t("browser.clearCache")}</DropdownItem>
        </DropdownContent>
      </Dropdown>
    </div>
    <LoginOfferBar sessionId={sessionId} />
    {device.kind === "device" && !floating ? <BrowserDeviceToolbar device={device} onChange={setDevice} /> : null}
    {browser && browser.tabs.length > 0 ? <div role="tablist" aria-label={t("Browser")} className="scroll-thin mt-1.5 flex items-center gap-1 overflow-x-auto px-2 pb-0.5">
      {browser.tabs.map((tab) => {
        const selected = tab.id === browser.activeTabId;
        return <div key={tab.id} role="tab" aria-selected={selected} tabIndex={0}
          onClick={() => void browserSelectTab(sessionId, tab.id)}
          onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); void browserCloseTab(sessionId, tab.id); } }}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void browserSelectTab(sessionId, tab.id); } }}
          className={cn("group flex h-7 min-w-0 max-w-[132px] flex-none cursor-pointer items-center gap-1.5 rounded-[10px] border px-2 transition-colors duration-[var(--motion-fast)]",
            selected ? "border-border-subtle bg-background-2 text-text-primary" : "border-transparent text-text-secondary hover:bg-background-2/60")}>
          {/* The close button takes the favicon's place while the tab is hovered or focused. */}
          <span className="relative flex size-4 shrink-0 items-center justify-center">
            <span className="flex transition-opacity duration-[var(--motion-fast)] group-hover:opacity-0 group-focus-within:opacity-0"><TabFavicon tab={tab} /></span>
            <button type="button" title={t("Close tab")} aria-label={t("Close tab")} onClick={(event) => { event.stopPropagation(); void browserCloseTab(sessionId, tab.id); }}
              className="absolute inset-0 flex items-center justify-center rounded-[4px] text-text-muted opacity-0 transition-opacity duration-[var(--motion-fast)] hover:bg-background-3 hover:text-text-primary group-hover:opacity-100 focus-visible:opacity-100"><X size={11} aria-hidden="true" /></button>
          </span>
          <span className="min-w-0 flex-1 truncate ui-caption">{tab.title || t("New tab")}</span>
        </div>;
      })}
      <NewTabMenu sessionId={sessionId} profiles={profiles} disabled={!browser.open} className={cn(controlClass, "ml-0.5")} />
    </div> : null}
    {browser?.dialog && !floating ? <BrowserDialogBar key={`${browser.dialog.tabId}:${browser.dialog.message}`} sessionId={sessionId} dialog={browser.dialog} /> : null}
    <BrowserViewport sessionId={sessionId} device={floating ? { kind: "fill" } : device} onDevice={setDevice} frame={viewport} still={still}>
      {floating ? <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-text-muted">
        <PictureInPicture size={20} aria-hidden="true" />
        <p className="ui-control text-text-secondary">{t("browser.pipShowing")}</p>
        <button type="button" onClick={() => void togglePictureInPicture()} disabled={pipBusy}
          className="rounded-[8px] px-2 py-1 ui-control text-text-secondary hover:bg-background-3 hover:text-text-primary disabled:opacity-50">{t("browser.pipBack")}</button>
      </div> : !browser || browser.tabs.length === 0 ? <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-text-muted">
        <Globe size={20} aria-hidden="true" />
        <p className="ui-control">{t("No tabs open")}</p>
        <button type="button" onClick={() => void browserNewTab(sessionId)} disabled={!browser?.open}
          className="rounded-[8px] px-2 py-1 ui-control text-text-secondary hover:bg-background-3 hover:text-text-primary disabled:opacity-50">{t("New tab")}</button>
      </div> : blank ? <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <Globe size={20} aria-hidden="true" className="text-text-muted" />
        {servers.length > 0 ? <>
          <p className="ui-control text-text-secondary">{t("Local servers")}</p>
          <div className="flex w-full max-w-[320px] flex-col gap-1">
            {servers.map((server) => <button key={server.url} type="button" onClick={() => { if (active) void browserNavigate(sessionId, active.id, server.url); }}
              className="flex min-w-0 items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 ui-control text-text-secondary hover:bg-background-3 hover:text-text-primary">
              <span className="truncate">{server.url}</span>
              {server.process ? <span className="shrink-0 truncate ui-caption text-text-muted">{server.process}</span> : null}
            </button>)}
          </div>
        </> : <p className="ui-control text-text-secondary">{t("Start a new page")}</p>}
      </div> : null}
    </BrowserViewport>
    {notice ? <div className="pointer-events-none absolute left-1/2 top-1.5 z-50 w-[min(320px,80%)] -translate-x-1/2">
      <ArcToast key={notice} variant="success" title={t(notice)} duration={1600} dismissLabel={t("common.dismiss")} onOpenChange={(open) => { if (!open) setNotice(null); }} />
    </div> : null}
  </div>;
}

/** The + button: a new tab in the Settings default, or in another browser profile (ADR-150). */
function NewTabMenu({ sessionId, profiles, disabled, className }: { sessionId: string; profiles: BrowserProfile[]; disabled: boolean; className: string }) {
  const t = useTranslation();
  const open = (profile: string | null) => void useAppStore.getState().browserNewTab(sessionId, null, profile);
  return <Dropdown>
    <DropdownTrigger asChild>
      <button type="button" title={t("browser.newTabIn")} aria-label={t("browser.newTabIn")} disabled={disabled} className={className}><Plus size={13} aria-hidden="true" /></button>
    </DropdownTrigger>
    <DropdownContent align="start" className="min-w-[200px]">
      <DropdownItem onSelect={() => open(null)}>{t("New tab")}</DropdownItem>
      <DropdownSeparator />
      <DropdownItem onSelect={() => open("default")}>{t("browser.profileDefault")}</DropdownItem>
      <DropdownItem onSelect={() => open("private")}>{t("browser.profilePrivate")}</DropdownItem>
      {profiles.map((profile) => <DropdownItem key={profile.id} onSelect={() => open(profile.id)}>{profile.name}</DropdownItem>)}
    </DropdownContent>
  </Dropdown>;
}

/** A page's alert, confirm or prompt. The person answers here; an agent can answer with browser_dialog (ADR-150). */
function BrowserDialogBar({ sessionId, dialog }: { sessionId: string; dialog: BrowserDialog }) {
  const t = useTranslation();
  const [text, setText] = useState(dialog.defaultText ?? "");
  const answer = (accept: boolean) => {
    void client.browserDialogReply(sessionId, dialog.tabId, accept, dialog.kind === "prompt" && accept ? text : null).then(
      (state) => useAppStore.setState((current) => ({ browserBySession: { ...current.browserBySession, [sessionId]: state } })),
      (error) => useAppStore.setState({ error: formatUnknownError(error) }),
    );
  };
  const title = t(dialog.kind === "alert" ? "browser.dialogAlert" : dialog.kind === "confirm" ? "browser.dialogConfirm" : "browser.dialogPrompt");
  return <div role="alertdialog" aria-label={title} className="mx-2 mb-1 flex flex-col gap-2 rounded-[10px] border border-border-subtle bg-background-2 p-2.5">
    <p className="ui-caption text-text-muted">{title} · {dialog.url}</p>
    <p className="whitespace-pre-wrap break-words ui-control text-text-primary">{dialog.message}</p>
    {dialog.kind === "prompt" ? <input value={text} onChange={(event) => setText(event.target.value)} aria-label={dialog.message}
      className="h-7 rounded-[var(--radius-md)] border border-border-default bg-background-1 px-2 ui-control text-text-primary outline-none" /> : null}
    <div className="flex justify-end gap-2">
      {dialog.kind !== "alert" ? <button type="button" onClick={() => answer(false)} className="rounded-[8px] px-2 py-1 ui-control text-text-secondary hover:bg-background-3 hover:text-text-primary">{t("browser.dialogCancel")}</button> : null}
      <button type="button" onClick={() => answer(true)} className="rounded-[8px] bg-background-3 px-2 py-1 ui-control text-text-primary hover:bg-background-3/80">{t("browser.dialogOk")}</button>
    </div>
  </div>;
}
