import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { AgentActivity } = await server.ssrLoadModule("/src/components/AgentActivity.tsx");
  const { AgentRequests } = await server.ssrLoadModule("/src/components/AgentRequests.tsx");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const { mergeSettings } = await server.ssrLoadModule("/src/lib/settings.ts");
  const { translate } = await server.ssrLoadModule("/src/i18n/index.ts");
  const snapshot = useAppStore.getInitialState();
  const activity = { provider: "opencode", model: "<native-model>", startedAt: 1000, endedAt: 69000, waitingSince: null, pausedMs: 0, status: "completed", truncated: false, items: [{ id: "read", kind: "read", label: "Read / search", state: "completed", model: null }, { id: "child", kind: "agent", label: "Review <child>", state: "unknown", model: "child-model" }] };
  for (const locale of ["pt-BR", "en"]) for (const theme of ["dark", "light", "translucent"]) {
    const settings = mergeSettings({ locale, appearanceMode: theme });
    Object.assign(snapshot, { settings }); useAppStore.setState({ settings });
    const html = renderToString(createElement(AgentActivity, { activity }));
    assert.ok(html.includes("1m 8s")); assert.ok(html.includes("&lt;native-model&gt;"));
    assert.ok(html.includes(translate(locale, "Not reported"))); assert.ok(html.includes('aria-expanded="true"'));
    assert.ok(!html.includes("Stop agent"), "child rows never acquire control authority");
    const empty = renderToString(createElement(AgentActivity, { activity: { ...activity, items: [] } }));
    assert.ok(!empty.includes("<button"), "no disclosure when no details are offered");
    const request = { requestId: "r", generation: "g", turnId: "t", itemId: "i", kind: { type: "userInput", questions: [{ id: "q1", header: "Scope", question: "First question?", isOther: true, isSecret: false, options: [{ label: "Choice", description: "Description" }] }, { id: "q2", header: "Style", question: "Second question?", isOther: true, isSecret: false, options: null }] } };
    const session = { id: "s", agent: "opencode", pendingRequests: [request] };
    const question = renderToString(createElement(AgentRequests, { session }));
    assert.ok(question.includes("OpenCode"), "provider label is accurate");
    assert.ok(question.includes("First question?")); assert.ok(!question.includes("Second question?"));
    assert.ok(question.replaceAll(/<!--.*?-->/g, "").includes("1/2")); assert.ok(question.includes(translate(locale, "Continue")));
    assert.match(question, /type="submit"[^>]*disabled/);
    const permission = renderToString(createElement(AgentRequests, { session: { ...session, pendingRequests: [{ ...request, kind: { type: "command", command: "npm test", cwd: "/fixture", reason: "Review first" } }] } }));
    for (const key of ["Allow once", "Decline", "Cancel turn"]) assert.ok(permission.includes(translate(locale, key)));
    assert.ok(permission.includes("npm test"));
  }
  console.log("Activity SSR: both locales and three themes, native labels/status, escaped metadata, question progress and explicit approval actions passed");
} finally { await server.close(); }
