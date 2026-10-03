import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

// React's external-store hook must receive the same snapshot reference when
// Zustand has not changed. SSR alone cannot detect a newly allocated fallback.
const server = await createServer({
  server: { middlewareMode: true, hmr: false }, appType: "custom",
  plugins: [{
    name: "verify-browser-snapshots", enforce: "pre",
    transform(source, id) {
      if (!id.endsWith("/src/components/BrowserPanel.tsx")) return;
      assert.ok(source.includes('import { useAppStore } from "@/store/app-store";'), "the real BrowserPanel store hook must be instrumented");
      return source.replace('import { useAppStore } from "@/store/app-store";', `
        import { useAppStore as realStore } from "@/store/app-store";
        function useAppStore(selector) {
          const state = realStore.getInitialState();
          const first = selector(state);
          if (!Object.is(first, selector(state))) throw new Error("BrowserPanel selector returns an unstable snapshot");
          return realStore(selector);
        }
        useAppStore.getState = realStore.getState;
        useAppStore.setState = realStore.setState;
      `);
    },
  }],
});
try {
  const { BrowserPanel } = await server.ssrLoadModule("/src/components/BrowserPanel.tsx");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const snapshot = useAppStore.getInitialState();
  for (const locale of ["pt-BR", "en"]) {
    snapshot.settings = { ...snapshot.settings, locale };
    for (const populated of [false, true]) {
      snapshot.browserHistoryBySession = populated ? { fixture: ["https://example.com"] } : {};
      snapshot.localServersBySession = populated ? { fixture: ["http://localhost:1420"] } : {};
      for (const url of [null, "about:blank", "https://example.com"]) {
        snapshot.browserBySession = url === null ? {} : { fixture: {
          sessionId: "fixture", open: true, activeTabId: "tab",
          tabs: [{ id: "tab", url, title: "Example", loading: false, canGoBack: false, canGoForward: false, faviconUrl: null }],
        } };
        const html = renderToString(createElement(BrowserPanel, { sessionId: "fixture" }));
        assert.ok(html.includes("<input"), "address control renders before and after native browser startup");
        assert.ok(html.includes(locale === "en" ? "Address" : "Endereço"));
      }
    }
  }
  console.log("BrowserPanel: stable snapshots before/after startup, empty/populated session URLs and both locales passed");
} finally { await server.close(); }
