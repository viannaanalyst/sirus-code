import "./styles/index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { formatUnknownError, isResizeObserverDeliveryWarning } from "./lib/format-error";
import { useAppStore } from "./store/app-store";
import { configureDynamicStyleNonce } from "./lib/editor-nonce";
import { isRemoteUi, onRemoteConnection } from "./client";
import { REMOTE_TOKEN_KEY, deviceName, pairingCode, redeemPairing } from "./client/remote-pairing";

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

const portuguese = navigator.language.toLowerCase().startsWith("pt");

/** A plain notice for a device that cannot use the Mac yet (remote access, ADR-080). */
function showRemoteNotice(text: string) {
  const root = document.getElementById("root");
  if (!root) return;
  const panel = document.createElement("div");
  panel.className = "flex h-screen flex-col items-center justify-center gap-3 bg-background-0 px-8 text-center text-text-primary";
  const title = document.createElement("p");
  title.className = "ui-title";
  title.textContent = "Sirus Code";
  const message = document.createElement("p");
  message.className = "text-text-secondary";
  message.textContent = text;
  panel.append(title, message);
  root.replaceChildren(panel);
}

/** Pairs this device from the QR link, or explains how to; `true` when the app can start. */
async function prepareRemote(): Promise<boolean> {
  const code = pairingCode(window.location.search);
  if (code) {
    window.history.replaceState(null, "", window.location.pathname);
    try {
      window.localStorage.setItem(REMOTE_TOKEN_KEY, await redeemPairing(code, deviceName(navigator.userAgent)));
    } catch (error) {
      showRemoteNotice(formatUnknownError(error));
      return false;
    }
  }
  if (!window.localStorage.getItem(REMOTE_TOKEN_KEY)) {
    showRemoteNotice(portuguese
      ? "Este aparelho ainda não está conectado. No Mac, abra Configurações → Conexões e leia o QR code."
      : "This device is not connected yet. On the Mac, open Settings → Connections and scan the QR code.");
    return false;
  }
  let lost = false;
  onRemoteConnection((state) => {
    if (state === "lost") lost = true;
    // State may have moved on while the Mac was out of reach; start again from it.
    if (state === "open" && lost) window.location.reload();
    if (state === "unauthorized") {
      window.localStorage.removeItem(REMOTE_TOKEN_KEY);
      showRemoteNotice(portuguese
        ? "O acesso deste aparelho foi removido no Mac. Leia um novo QR code para conectar de novo."
        : "This device's access was removed on the Mac. Scan a new QR code to connect again.");
    }
  });
  return true;
}

function render() {
  try {
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement, { onUncaughtError: (error) => showFatal(error) }).render(
      <React.StrictMode><App /></React.StrictMode>,
    );
  } catch {
    showFatal();
  }
}

if (isRemoteUi) void prepareRemote().then((ready) => { if (ready) render(); });
else render();
