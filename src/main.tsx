import "./styles/index.css";
import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { formatUnknownError, isOpaqueScriptError, isResizeObserverDeliveryWarning } from "./lib/format-error";
import { useAppStore } from "./store/app-store";
import { configureDynamicStyleNonce } from "./lib/editor-nonce";
import { isRemoteUi, onRemoteConnection } from "./client";
import { REMOTE_TOKEN_KEY, deviceName, pairingCode, redeemPairing } from "./client/remote-pairing";
import { MobileConnect } from "./components/mobile/MobileConnect";
import { translate } from "./i18n";
import { dismissAppSplash } from "./lib/app-splash";
import { MOBILE_QUERY } from "./lib/mobile";
import { syncViewport } from "./lib/mobile-viewport";

configureDynamicStyleNonce(document);

function showFatal(error?: unknown) {
  console.error(error);
  const root = document.getElementById("root");
  if (!root) return;
  const english = useAppStore.getState().settings.locale === "en";
  const panel = document.createElement("div");
  panel.className = "flex h-screen flex-col items-center justify-center gap-4 bg-background-0 text-text-primary";
  const message = document.createElement("p");
  message.textContent = english ? "Sirus Code could not render this view." : "O Sirus Code não conseguiu exibir esta tela.";
  const retry = document.createElement("button");
  retry.className = "rounded-lg border border-border-subtle px-4 py-2";
  retry.textContent = english ? "Reload" : "Recarregar";
  retry.onclick = () => window.location.reload();
  panel.append(message, retry);
  // React may still be clearing a failed tree when onUncaughtError runs.
  queueMicrotask(() => root.replaceChildren(panel));
}

window.addEventListener("error", (event) => {
  if (isResizeObserverDeliveryWarning(event)) return;
  if (isOpaqueScriptError(event)) { console.warn("Ignored an opaque script error (another origin)."); return; }
  useAppStore.setState({ error: formatUnknownError(event.error ?? event.message) });
});
window.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  useAppStore.setState({ error: formatUnknownError(event.reason) });
});

// The app frame never scrolls: a stray scrollIntoView elsewhere would push the whole window
// up under the titlebar (sidebar cut at the bottom). Any such shift is undone at once.
window.addEventListener("scroll", (event) => {
  const target = event.target;
  const frame = target === document ? document.scrollingElement : target instanceof HTMLElement && (target === document.body || target.id === "root") ? target : null;
  if (frame && (frame.scrollTop || frame.scrollLeft)) { frame.scrollTop = 0; frame.scrollLeft = 0; }
}, true);

// Finder drops arrive natively (`dragDropEnabled`, the `file-drop` event; ADR-073). Should
// a file drag still reach the webview, it must never navigate the window to the file.
for (const type of ["dragover", "drop"] as const) {
  window.addEventListener(type, (event) => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  });
}

const MobileApp = lazy(() => import("./components/mobile/MobileApp"));
let root: ReactDOM.Root | null = null;

function mount(node: React.ReactNode) {
  try {
    root ??= ReactDOM.createRoot(document.getElementById("root") as HTMLElement, { onUncaughtError: (error) => showFatal(error) });
    root.render(<React.StrictMode>{node}</React.StrictMode>);
  } catch {
    showFatal();
  }
}

/** Exchanges a pairing code and starts over paired; returns the Mac's refusal otherwise. */
async function pair(code: string): Promise<string | null> {
  try {
    window.localStorage.setItem(REMOTE_TOKEN_KEY, await redeemPairing(code, deviceName(navigator.userAgent)));
    window.location.replace("/");
    return null;
  } catch (error) {
    return formatUnknownError(error);
  }
}

function showConnect(notice?: string | null) {
  dismissAppSplash();
  mount(<MobileConnect notice={notice} onCode={pair} />);
}

/** The UI served to another device (ADR-080/081): pair first, then the phone app or the full app. */
async function startRemote() {
  const code = pairingCode(window.location.search);
  if (code) {
    window.history.replaceState(null, "", window.location.pathname);
    const refusal = await pair(code);
    if (refusal) showConnect(refusal);
    return;
  }
  if (!window.localStorage.getItem(REMOTE_TOKEN_KEY)) {
    showConnect();
    return;
  }
  let lost = false;
  onRemoteConnection((state) => {
    if (state === "lost") lost = true;
    // State may have moved on while the Mac was out of reach; start again from it.
    if (state === "open" && lost) window.location.reload();
    if (state === "unauthorized") {
      window.localStorage.removeItem(REMOTE_TOKEN_KEY);
      showConnect(translate(navigator.language.toLowerCase().startsWith("pt") ? "pt-BR" : "en", "mobile.connect.revoked"));
    }
  });
  mount(window.matchMedia(MOBILE_QUERY).matches ? <Suspense fallback={null}><MobileApp /></Suspense> : <App />);
}

if (isRemoteUi) { syncViewport(); void startRemote(); }
else mount(<App />);
