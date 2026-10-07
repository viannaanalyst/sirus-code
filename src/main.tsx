import "./styles/index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { formatUnknownError, isResizeObserverDeliveryWarning } from "./lib/format-error";
import { useAppStore } from "./store/app-store";
import { configureDynamicStyleNonce } from "./lib/editor-nonce";

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

try {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement, { onUncaughtError: (error) => showFatal(error) }).render(
    <React.StrictMode><App /></React.StrictMode>,
  );
} catch {
  showFatal();
}
