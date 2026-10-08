import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";
// Claude background subagents (ADR-097): the strip above the composer, their states in the
// timeline, and the header pill while they run or after they were interrupted.
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { BackgroundTasks } = await server.ssrLoadModule("/src/components/BackgroundTasks.tsx");
  const { AgentActivity } = await server.ssrLoadModule("/src/components/AgentActivity.tsx");
  const { backgroundStateLabel, resumeBackgroundPrompt } = await server.ssrLoadModule("/src/lib/background-tasks.ts");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const { mergeSettings } = await server.ssrLoadModule("/src/lib/settings.ts");
  const { translate } = await server.ssrLoadModule("/src/i18n/index.ts");
  const snapshot = useAppStore.getInitialState();
  const now = Date.now();
  const child = (id, label, state, extra = {}) => ({ id: `agent:${id}`, kind: "agent", label, state, model: null, background: true, startedAt: now - 120_000, endedAt: state === "running" ? null : now - 120_000 + 190_000, ...extra });
  const running = [child("a1", "Audit BigQuery queries", "running", { detail: "Running npm test" }), child("a2", "Audit navigation", "running")];
  const activity = (status, items) => ({ provider: "claude", model: null, startedAt: now - 200_000, endedAt: ["running", "waiting", "starting"].includes(status) ? null : now, waitingSince: null, pausedMs: 0, status, truncated: false, items });
  const message = (status, items) => ({ id: "m", sessionId: "s", role: "agent", content: "Agora aguardo as três análises.", createdAt: "time", streaming: status === "running", activity: activity(status, items) });
  for (const locale of ["pt-BR", "en"]) {
    const t = (key, params) => translate(locale, key, params);
    const settings = mergeSettings({ locale, foldFinishedTurns: false });
    Object.assign(snapshot, { settings }); useAppStore.setState({ settings });
    // A: the strip lists the running ones, with what they do now and a stop for each.
    const strip = renderToString(createElement(BackgroundTasks, { session: { id: "s", status: "running" }, message: message("running", [...running, child("a3", "Done already", "completed")]) }));
    assert.ok(strip.includes("data-background-tasks") && strip.includes(t("background.title")), "the strip shows while background work runs");
    assert.equal((strip.match(/class="background-task"/g) ?? []).length, 2, "only running tasks are listed");
    assert.ok(strip.includes("Audit BigQuery queries") && strip.includes("Running npm test"), "name and current step");
    assert.ok(strip.includes("2m 0s"), "elapsed time");
    assert.ok(strip.includes(t("background.stop", { name: "Audit navigation" })), "a stop per task");
    assert.ok(!/uppercase/.test(strip), "labels are never forced into capitals");
    assert.equal(renderToString(createElement(BackgroundTasks, { session: { id: "s", status: "completed" }, message: message("completed", running) })), "", "hidden once the reply ended");
    assert.equal(renderToString(createElement(BackgroundTasks, { session: { id: "s", status: "running" }, message: message("running", []) })), "", "hidden when none runs");
    // B: timeline states, with an icon and a tone per state.
    assert.equal(backgroundStateLabel(running[0], now, t), t("background.state.running", { duration: "2m 0s" }));
    assert.equal(backgroundStateLabel(child("x", "x", "completed"), now, t), t("background.state.completed", { duration: "3m 10s" }));
    assert.equal(backgroundStateLabel(child("x", "x", "failed"), now, t), t("background.state.failed"));
    assert.equal(backgroundStateLabel(child("x", "x", "stopped"), now, t), t("background.state.interrupted"));
    assert.equal(backgroundStateLabel(child("x", "x", "stopped", { timedOut: true }), now, t), t("background.state.timedOut"));
    const live = renderToString(createElement(AgentActivity, { activity: activity("running", running) }));
    assert.ok(live.includes('class="subagent-pill" data-tone="running"') && live.includes(t("subagent.state.running")) && live.includes("2m 0s"), "running pill and elapsed time on the card");
    assert.ok(live.includes(`${t("subagent.role.background")} · Running npm test`), "the card names its role and current step");
    // C: the header pill while they run, and the reply is not presented as finished.
    assert.ok(live.includes(t("background.running", { count: 2 })), "header pill counts running background tasks");
    assert.ok(!live.includes(t("timeline.workedFor", { duration: "" }).trim()), "a reply with background work still running is not finished");
    const finished = [child("b1", "Audit queries", "completed"), child("b2", "Audit cache", "failed"), child("b3", "Audit bundle", "stopped"), child("b4", "Audit RSC", "stopped", { timedOut: true })];
    let resumed = null;
    const ended = renderToString(createElement(AgentActivity, { activity: activity("stopped", finished), onResume: (text) => { resumed = text; } }));
    for (const tone of ["completed", "failed", "interrupted", "timedOut"]) assert.ok(ended.includes(`class="subagent-pill" data-tone="${tone}"`) && ended.includes(t(`subagent.state.${tone}`)), `${tone} pill`);
    assert.ok(ended.includes(t("background.interrupted", { count: 2 })), "interrupted pill");
    assert.ok(ended.includes(t("background.resume")), "Retomar offered on the latest reply");
    assert.ok(!ended.includes(t("background.running", { count: 0 })), "no running pill after the turn");
    assert.equal(resumed, null);
    assert.equal(resumeBackgroundPrompt(finished.slice(2), t), t("background.resumePrompt", { names: "Audit bundle; Audit RSC" }));
    const older = renderToString(createElement(AgentActivity, { activity: activity("stopped", finished) }));
    assert.ok(older.includes(t("background.interrupted", { count: 2 })) && !older.includes(t("background.resume")), "older replies show the count without Retomar");
    const one = renderToString(createElement(AgentActivity, { activity: activity("completed", [child("c", "Only", "stopped")]) }));
    assert.ok(one.includes(t("background.interrupted.one")), "singular pill");
  }
  assert.equal(translate("pt-BR", "background.resumePrompt", { names: "A" }), "Retome as tarefas em segundo plano que foram interrompidas: A");
  console.log("Background tasks: strip with running rows, stop per task and time; timeline cards with running/completed/failed/interrupted/timed-out pills; header pill and Retomar in both locales");
} finally { await server.close(); }
