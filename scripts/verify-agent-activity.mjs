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
    const settings = mergeSettings({ locale, appearanceMode: theme, foldFinishedTurns: false });
    Object.assign(snapshot, { settings }); useAppStore.setState({ settings });
    const html = renderToString(createElement(AgentActivity, { activity }));
    assert.ok(html.includes("1m 8s")); assert.ok(html.includes("&lt;native-model&gt;"));
    assert.ok(html.includes(translate(locale, "Not reported"))); assert.ok(html.includes('aria-expanded="true"'));
    assert.ok(!html.includes("Stop agent"), "child rows never acquire control authority");
    // A subagent is a card (T3 Code): one button with the title, its role and model, and a state pill.
    assert.match(html, /<li class="subagent-card" data-state="unknown" data-tone="unknown"/, "the subagent renders as a card");
    assert.match(html, /<button type="button" class="subagent-card-head" aria-expanded="false"/, "the whole card is the disclosure");
    assert.ok(html.includes("Review &lt;child&gt;") && html.includes(`${translate(locale, "subagent.role")} · child-model`), "title, role and model");
    assert.ok(!/uppercase/.test(html), "labels are never forced into capitals");
    const steps = [{ id: "e1", kind: "edit", label: "Edit", state: "completed" }, { id: "e2", kind: "edit", label: "Edit", state: "completed" }, { id: "c", kind: "command", label: "Command", state: "running" }];
    const child = { id: "agent:k", kind: "agent", label: "Server-side optimizations batch", model: null, startedAt: 1000, endedAt: null, steps };
    const working = renderToString(createElement(AgentActivity, { activity: { ...activity, status: "running", endedAt: null, items: [{ ...child, state: "running" }] } }));
    assert.ok(working.includes(`data-tone="running"`) && working.includes(translate(locale, "subagent.state.running")), "running pill");
    assert.ok(working.includes(`${translate(locale, "subagent.role")} · ${translate(locale, "Running a command…")}`), "running: role and current step");
    assert.ok(working.includes(translate(locale, "{count} steps", { count: 3 })) && working.includes("subagent-pill-dot"), "step count and live dot");
    const done = renderToString(createElement(AgentActivity, { activity: { ...activity, items: [{ ...child, state: "completed", endedAt: 235000, steps: steps.map((step) => ({ ...step, state: "completed" })) }] } }));
    assert.ok(done.includes(translate(locale, "subagent.state.completed")) && done.includes("3m 54s"), "done pill and elapsed time");
    assert.ok(done.includes(`${translate(locale, "subagent.role")} · ${translate(locale, "subagent.edits", { count: 2 })}`), "done: what it left");
    const failed = renderToString(createElement(AgentActivity, { activity: { ...activity, items: [{ ...child, state: "failed", endedAt: 5000, steps: [{ id: "x", kind: "command", label: "Command", state: "failed" }] }] } }));
    assert.ok(failed.includes(translate(locale, "subagent.state.failed")) && /class="subagent-card-head" aria-expanded="true"/.test(failed) && failed.includes('class="activity-child-steps"'), "a failed card opens its trail");
    assert.ok(html.includes(translate(locale, "timeline.workedFor", { duration: "1m 8s" })), "a finished turn reads Worked for …");
    // A folded turn hides its work behind the header; the T3 timeline interleaves text and work in order.
    // Server rendering reads the initial store snapshot.
    Object.assign(snapshot, { settings: { ...settings, foldFinishedTurns: true } });
    const folded = renderToString(createElement(AgentActivity, { activity }));
    assert.ok(folded.includes('aria-expanded="false"') && !folded.includes("Review &lt;child&gt;"));
    const turn = { ...activity, items: [{ id: "skill:graphify", kind: "skill", label: "Skill", state: "completed", model: null, detail: "graphify", offset: 0 }, { id: "r", kind: "read", label: "Read / search", state: "completed", model: null, detail: "/fixture/src/app.ts", offset: 6 }] };
    const interleaved = renderToString(createElement(AgentActivity, { activity: turn, content: "Antes\nDepois", cwd: "/fixture", renderText: (start, end) => createElement("p", null, `[${"Antes\nDepois".slice(start, end).trim()}]`) }));
    assert.ok(interleaved.includes("[Depois]") && !interleaved.includes("[Antes]"), "folded: only the final answer shows");
    Object.assign(snapshot, { settings });
    const open = renderToString(createElement(AgentActivity, { activity: turn, content: "Antes\nDepois", cwd: "/fixture", renderText: (start, end) => createElement("p", null, `[${"Antes\nDepois".slice(start, end).trim()}]`) })).replaceAll(/<!--.*?-->/g, "");
    const order = ["/graphify", "[Antes]", "src/app.ts", "[Depois]"].map((needle) => open.indexOf(needle));
    assert.ok(order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1])), `skill, text, read and final text in order: ${order}`);
    assert.ok(!open.includes("/fixture/src"), "workspace paths show relative");
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
  console.log("Activity SSR: both locales and three themes, subagent cards (role, step, result, state pill), T3 timeline order/fold, relative paths, native labels/status, escaped metadata, question progress and explicit approval actions passed");
} finally { await server.close(); }
