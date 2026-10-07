import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserPersonAction, BrowserSessionState } from "@/client/types";
import { client } from "@/client";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronLeft, Globe, LoaderCircle, Plus, RefreshCw, X } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { browserAddressDisplayValue, normalizeBrowserAddressInput } from "@/lib/browser-url";
import { formatUnknownError } from "@/lib/format-error";
import { pageTapPoint } from "@/lib/mobile";
import { useAppStore } from "@/store/app-store";
import type { MobileNavigation } from "./MobileApp";

const KEYS = ["Enter", "Backspace", "Tab", "Escape"] as const;
const POLL_MS = 1200;

/**
 * The conversation's browser on the Mac, from the phone (ADR-087): a live picture of
 * the active tab, refreshed while the screen is open. Tapping the picture clicks the
 * page there; typing goes to the focused field. These count as the person's own use,
 * so an agent acting on the page pauses, as it does for a click on the Mac.
 */
export function MobileBrowser({ sessionId, navigation }: { sessionId: string; navigation: MobileNavigation }) {
  const t = useTranslation();
  const session = useAppStore((state) => state.sessions.find((item) => item.id === sessionId));
  const [state, setState] = useState<BrowserSessionState | null>(null);
  const [picture, setPicture] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pictureRef = useRef<HTMLImageElement>(null);
  const press = useRef<{ x: number; y: number } | null>(null);
  const refreshing = useRef(false);
  const tab = state?.tabs.find((item) => item.id === state.activeTabId) ?? null;
  const tabId = tab?.id ?? null;

  const shownTab = useRef(tabId);
  shownTab.current = tabId;

  const refresh = useCallback(async () => {
    if (!tabId || refreshing.current || document.visibilityState !== "visible") return;
    refreshing.current = true;
    try {
      const data = await client.browserPreview(sessionId, tabId);
      // A picture of a tab the person has since left is dropped.
      if (shownTab.current === tabId) setPicture(`data:image/jpeg;base64,${data}`);
    } catch { /* the next poll tries again */ } finally { refreshing.current = false; }
  }, [sessionId, tabId]);

  useEffect(() => {
    let cancelled = false;
    void client.browserState(sessionId).then((next) => { if (!cancelled) setState(next); }, () => { if (!cancelled) setState(null); });
    let unlisten: (() => void) | null = null;
    void client.onBrowserState((next) => { if (next.sessionId === sessionId) setState(next); }).then((stop) => { if (cancelled) stop(); else unlisten = stop; });
    return () => { cancelled = true; unlisten?.(); };
  }, [sessionId]);

  useEffect(() => { if (!editing) setAddress(browserAddressDisplayValue(tab?.url ?? "")); }, [tab?.url, editing]);

  useEffect(() => {
    setPicture(null);
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      const result = await work();
      if (result && typeof result === "object" && "sessionId" in result) setState(result as BrowserSessionState);
      else if (result && typeof result === "object" && "ok" in result && result.ok === false && "error" in result) setError(String(result.error));
    } catch (reason) { setError(formatUnknownError(reason)); }
    window.setTimeout(() => void refresh(), 250);
  };
  const act = (action: BrowserPersonAction) => { if (tabId) void run(() => client.browserPersonAction(sessionId, tabId, action)); };

  const go = () => {
    const url = normalizeBrowserAddressInput(address);
    if (!url) return;
    (document.activeElement as HTMLElement | null)?.blur();
    setEditing(false);
    void run(() => tabId ? client.browserNavigate(sessionId, tabId, url) : client.browserNewTab(sessionId, url));
  };

  const release = (event: React.PointerEvent<HTMLImageElement>) => {
    const start = press.current;
    press.current = null;
    const image = pictureRef.current;
    if (!start || !image) return;
    const box = image.getBoundingClientRect();
    const natural = { width: image.naturalWidth, height: image.naturalHeight };
    const moved = event.clientY - start.y;
    if (Math.abs(moved) > 12) {
      // A swipe moves the page by the same share of its height as the finger moved.
      const height = natural.height * Math.min(box.width / natural.width, box.height / natural.height);
      if (height) act({ kind: "swipe", fraction: Math.max(-2, Math.min(2, -moved / height)) });
      return;
    }
    const point = pageTapPoint(box, natural, event.clientX, event.clientY);
    if (point) act({ kind: "tap", ...point });
  };

  const sendText = (submit: boolean) => {
    if (!text) return;
    act({ kind: "type", text, submit });
    setText("");
  };

  return <div className="mobile-page mobile-browser">
    <header className="mobile-bar">
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.back")} onClick={navigation.back}><ChevronLeft size={18} aria-hidden="true" /></button>
      <div className="mobile-bar-title"><h1>{tab?.title || t("mobile.browser")}</h1><p>{session?.title}</p></div>
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.browser.newTab")} onClick={() => void run(() => client.browserNewTab(sessionId, null))}><Plus size={18} aria-hidden="true" /></button>
    </header>
    {state && state.tabs.length > 1 ? <div className="mobile-browser-tabs" role="tablist">
      {state.tabs.map((item) => <div key={item.id} className="mobile-browser-tab" data-active={item.id === tabId || undefined}>
        <button type="button" role="tab" aria-selected={item.id === tabId} onClick={() => void run(() => client.browserSelectTab(sessionId, item.id))}>
          {item.faviconUrl ? <img src={item.faviconUrl} alt="" width={14} height={14} onError={(event) => { event.currentTarget.hidden = true; }} /> : <Globe size={14} aria-hidden="true" />}
          <span>{item.title || browserAddressDisplayValue(item.url) || t("mobile.browser.newTab")}</span>
        </button>
        <button type="button" aria-label={t("mobile.browser.closeTab")} onClick={() => void run(() => client.browserCloseTab(sessionId, item.id))}><X size={12} aria-hidden="true" /></button>
      </div>)}
    </div> : null}
    {tab ? <form className="mobile-browser-address" onSubmit={(event) => { event.preventDefault(); go(); }}>
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.browser.back")} disabled={!tab.canGoBack} onClick={() => void run(() => client.browserBack(sessionId, tab.id))}><ArrowLeft size={17} aria-hidden="true" /></button>
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.browser.forward")} disabled={!tab.canGoForward} onClick={() => void run(() => client.browserForward(sessionId, tab.id))}><ArrowRight size={17} aria-hidden="true" /></button>
      <input className="mobile-browser-url" value={address} onFocus={(event) => { setEditing(true); event.currentTarget.select(); }} onBlur={() => setEditing(false)} onChange={(event) => setAddress(event.target.value)}
        placeholder={t("mobile.browser.address")} aria-label={t("mobile.browser.address")} inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="go" />
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.browser.reload")} onClick={() => void run(() => client.browserReload(sessionId, tab.id))}>
        {tab.loading ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={17} aria-hidden="true" />}
      </button>
    </form> : null}
    <div className="mobile-browser-page">
      {!state ? <p className="mobile-empty"><LoaderCircle size={15} className="animate-spin" aria-hidden="true" /></p>
        : !tab ? <div className="mobile-empty mobile-browser-empty">
          <Globe size={28} aria-hidden="true" />
          <p>{t("mobile.browser.empty")}</p>
          <button type="button" className="mobile-primary" onClick={() => void run(() => client.browserOpen(sessionId))}>{t("mobile.browser.open")}</button>
        </div>
        : !browserAddressDisplayValue(tab.url) ? <p className="mobile-empty">{t("mobile.browser.blank")}</p>
        : picture ? <img ref={pictureRef} src={picture} alt={tab.title} className="mobile-browser-picture" draggable={false}
          onPointerDown={(event) => { press.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={release} onPointerCancel={() => { press.current = null; }} />
        : <p className="mobile-empty"><LoaderCircle size={15} className="animate-spin" aria-hidden="true" /></p>}
    </div>
    {tab ? <footer className="mobile-browser-controls">
      {error ? <p role="alert" className="mobile-help text-danger">{error}</p> : <p className="mobile-help">{t("mobile.browser.help")}</p>}
      <form className="mobile-browser-type" onSubmit={(event) => { event.preventDefault(); sendText(true); }}>
        <input className="mobile-browser-url" value={text} onChange={(event) => setText(event.target.value)} placeholder={t("mobile.browser.type")} aria-label={t("mobile.browser.type")} autoCapitalize="off" autoCorrect="off" enterKeyHint="send" />
        <button type="button" className="mobile-icon-button" aria-label={t("mobile.browser.send")} disabled={!text} onClick={() => sendText(false)}><ArrowUp size={17} aria-hidden="true" /></button>
      </form>
      <div className="mobile-browser-keys">
        {KEYS.map((key) => <button key={key} type="button" onClick={() => act({ kind: "key", key })}>{t(`mobile.browser.key.${key}`)}</button>)}
        <button type="button" aria-label={t("mobile.browser.scrollUp")} onClick={() => act({ kind: "scroll", dy: -500 })}><ArrowUp size={15} aria-hidden="true" /></button>
        <button type="button" aria-label={t("mobile.browser.scrollDown")} onClick={() => act({ kind: "scroll", dy: 500 })}><ArrowDown size={15} aria-hidden="true" /></button>
      </div>
    </footer> : null}
  </div>;
}
