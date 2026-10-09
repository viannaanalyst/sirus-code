// PR descriptions render as chat Markdown with https images (ADR-102); SSR only, no IPC.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { PullRequestBody } = await server.ssrLoadModule("/src/components/pull-requests/PullRequestDetail.tsx");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const body = "## Summary\n<!-- hidden template -->\n- **Bold** item with [docs](https://example.com/docs)\n\n<img alt=\"Shot\" src=\"https://github.com/user-attachments/assets/1\">\n\n<script>unsafe()</script>";
  for (const locale of ["pt-BR", "en"]) {
    useAppStore.getInitialState().settings = { ...useAppStore.getInitialState().settings, locale };
    const html = renderToString(createElement(PullRequestBody, { body }));
    assert.ok(html.includes('role="heading"') && html.includes(">Summary<"), "headings render");
    assert.ok(html.includes("<strong") && html.includes('role="list"'), "inline formatting and lists render");
    assert.ok(html.includes('class="chat-link"') && html.includes('title="https://example.com/docs"'), "links go through openLink");
    assert.ok(html.includes('src="https://github.com/user-attachments/assets/1"') && html.includes("chat-image-button"), "https images open in the gallery");
    assert.ok(html.includes("data-gallery-scope"), "the gallery is scoped to the description");
    assert.ok(!html.includes("hidden template") && !html.includes("<script>") && html.includes("&lt;script&gt;"), "comments dropped, HTML escaped");
    const empty = renderToString(createElement(PullRequestBody, { body: "<!-- only template -->" }));
    assert.ok(empty.includes(locale === "en" ? "No description." : "Sem descrição."), "an empty template shows the placeholder");
  }
  console.log("PR body: Markdown, links, https images in the gallery scope and escaped HTML verified in both locales");
} finally { await server.close(); }
