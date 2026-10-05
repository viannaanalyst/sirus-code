// Demo IPC for marketing recordings. Injected only into the app iframe of stage.html:
// it answers the app's Tauri calls with fictional data and plays a scripted agent turn.
// Never shipped in the app bundle.
(() => {
  if (window === window.top || !location.search.includes("demo")) return;
  const locale = new URLSearchParams(location.search).get("lang") === "pt" ? "pt-BR" : "en";
  const pt = locale === "pt-BR";
  const now = Date.now();
  const iso = (offset) => new Date(now - offset).toISOString();
  const listeners = new Map();
  let callbackId = 0;

  const projects = [
    { id: "atlas", name: "atlas", path: "/Users/demo/atlas", addedAt: iso(9e8), lastOpenedAt: iso(1000) },
    { id: "orbit-api", name: "orbit-api", path: "/Users/demo/orbit-api", addedAt: iso(8e8), lastOpenedAt: iso(9e6) },
    { id: "landing", name: "landing-site", path: "/Users/demo/landing-site", addedAt: iso(7e8), lastOpenedAt: iso(2e7) },
  ];
  const tree = (path) => ({ path, branch: "main", isolated: false });
  const activity = (provider, model, status, items, ago = 90000, ended = null) => ({ provider, model, startedAt: now - ago, endedAt: ended, waitingSince: status === "waiting" ? now - 8000 : null, pausedMs: 0, status, items, truncated: false });
  const item = (id, kind, label, state = "completed") => ({ id, kind, label, state, model: null });
  const message = (id, role, content, extra = {}) => ({ id, sessionId: extra.sessionId, role, content, createdAt: iso(extra.ago ?? 60000), streaming: false, ...extra });
  const session = (id, projectId, title, agent, model, status, messages, ago) => ({
    id, projectId, title, agent, model, status, createdAt: iso(ago), lastActivityAt: iso(ago / 3), worktree: tree(`/Users/demo/${projectId}`), lastError: null,
    messages: messages.map((m) => ({ ...m, sessionId: id })),
  });

  const sessions = [
    session("billing", "atlas", pt ? "Migrar cobrança para Stripe v3" : "Migrate billing to Stripe v3", "codex", "gpt-6.1-sol", "running", [
      message("b1", "user", pt ? "Migre a cobrança para a API v3 do Stripe." : "Migrate billing to the Stripe v3 API."),
      message("b2", "agent", "", { streaming: true, activity: activity("codex", "gpt-6.1-sol", "running", [item("b-r1", "read", "src/billing/stripe.ts"), item("b-e1", "edit", "src/billing/stripe.ts", "running")], 140000) }),
    ], 4e5),
    session("checkout", "atlas", pt ? "Corrigir teste instável do checkout" : "Fix flaky checkout test", "claude", "sonnet", "waiting", [
      message("c1", "user", pt ? "O teste de checkout falha às vezes no CI." : "The checkout test fails intermittently on CI."),
      message("c2", "agent", "", { streaming: true, activity: activity("claude", "sonnet", "waiting", [item("c-r1", "read", "tests/checkout.spec.ts"), item("c-c1", "command", "npm test -- checkout")], 60000) }),
    ], 3e5),
    session("darkmode", "atlas", pt ? "Refinar o modo escuro" : "Dark mode polish", "opencode", "kimi-k3", "completed", [
      message("d1", "user", pt ? "Ajuste os contrastes do modo escuro." : "Tune the dark mode contrast."),
      message("d2", "agent", pt ? "Pronto — ajustei 14 tokens de cor e o contraste agora passa AA em todas as superfícies." : "Done — tuned 14 color tokens; contrast now passes AA on every surface.", { activity: activity("opencode", "kimi-k3", "completed", [item("d-r1", "read", "src/styles/tokens.css"), item("d-e1", "edit", "src/styles/tokens.css")], 400000, now - 300000) }),
    ], 9e5),
    session("orbit-1", "orbit-api", pt ? "Paginar o endpoint de eventos" : "Paginate the events endpoint", "codex", "gpt-6.1-sol", "completed", [message("o1", "user", "Paginate /events.")], 2e6),
    session("landing-1", "landing", pt ? "Hero com vídeo" : "Video hero section", "claude", "opus", "completed", [message("l1", "user", "Build the hero.")], 3e6),
  ];

  // Probes and recordings may reshape the fictional data before the app loads.
  window.__demoSessions = sessions;
  const emit = (event, payload) => {
    for (const [handler, name] of listeners) if (name === event) window[`_${handler}`]?.({ event, id: handler, payload });
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));

  /* ---------- The scripted turn after Send ---------- */
  const reply = pt
    ? "Pronto. O login agora tem limite de tentativas com janela deslizante (5 por minuto por IP) e as requisições bloqueadas recebem 429 com Retry-After. O subagente de testes adicionou 6 testes — todos passando."
    : "Done. Login is now rate-limited with a sliding window (5 attempts per minute per IP), and blocked requests get a 429 with Retry-After. The test-writer subagent added 6 tests — all passing.";
  function playTurn(target) {
    const agent = target.messages.at(-1);
    const act = agent.activity;
    const push = () => emit("session-updated", clone(target));
    const steps = [
      [500, () => act.items.push(item("t-r1", "read", "src/server/auth/login.ts", "running"))],
      [1300, () => { act.items.at(-1).state = "completed"; act.items.push(item("t-r2", "read", "src/server/middleware/index.ts", "running")); }],
      [2000, () => { act.items.at(-1).state = "completed"; act.items.push({ ...item("t-a1", "agent", pt ? "Escritor de testes" : "Test writer", "running"), model: "gpt-6.1-sol" }); }],
      [2700, () => act.items.push(item("t-e1", "edit", "src/server/middleware/rateLimit.ts", "running"))],
      [3900, () => { act.items.find((i) => i.id === "t-e1").state = "completed"; act.items.push(item("t-e2", "edit", "src/server/auth/login.ts", "running")); }],
      [5000, () => { act.items.find((i) => i.id === "t-e2").state = "completed"; act.items.push(item("t-c1", "command", "npm test -- auth", "running")); }],
      [7200, () => { act.items.find((i) => i.id === "t-c1").state = "completed"; act.items.find((i) => i.id === "t-a1").state = "completed"; }],
    ];
    for (const [at, step] of steps) setTimeout(() => { step(); push(); }, at);
    // The answer streams in after the checks pass.
    const words = reply.split(" ");
    words.forEach((_, index) => setTimeout(() => { agent.content = words.slice(0, index + 1).join(" "); push(); }, 7400 + index * 55));
    setTimeout(() => {
      const end = 7400 + words.length * 55 + 300;
      agent.streaming = false; target.status = "completed";
      Object.assign(act, { status: "completed", endedAt: act.startedAt + end + 64000, review: {
        files: [
          { path: "src/server/middleware/rateLimit.ts", kind: "added", additions: 64, deletions: 0, binary: false, diff: "+export function rateLimit(windowMs = 60_000, max = 5) {\n+  const hits = new Map<string, number[]>();\n+  return (req, res, next) => {\n+    const now = Date.now();\n+    const recent = (hits.get(req.ip) ?? []).filter((t) => now - t < windowMs);\n+    if (recent.length >= max) return res.status(429).set(\"Retry-After\", \"60\").end();\n+    hits.set(req.ip, [...recent, now]);\n+    next();\n+  };\n+}\n" },
          { path: "src/server/auth/login.ts", kind: "modified", additions: 12, deletions: 3, binary: false, diff: "-router.post(\"/login\", login);\n+router.post(\"/login\", rateLimit(), login);\n" },
          { path: "tests/auth/rateLimit.test.ts", kind: "added", additions: 88, deletions: 0, binary: false, diff: "+it(\"blocks the sixth attempt with 429\", async () => { /* … */ });\n" },
        ],
        partial: false, sharedWorkspace: false, keptAt: null, expired: false,
      } });
      push();
    }, 7400 + words.length * 55 + 300);
  }

  /* ---------- IPC ---------- */
  const settings = { locale, openLastProject: true, sidebarCollapsed: false, defaultAgent: "codex", defaultModel: "codex::gpt-6.1-sol", usageProviders: [], enableProviderUpdateChecks: false, restorePreviousSessions: false };
  const installs = [["codex", "Codex", "0.160.0"], ["claude", "Claude Code", "2.1.288"], ["opencode", "OpenCode", "1.18.34"], ["cursor", "Cursor", null]].map(([id, name, version]) => ({ id, name, binary: id, installed: !!version, path: version ? `/usr/local/bin/${id}` : null, version }));
  const catalogs = {
    codex: [["gpt-6.1-sol", "GPT-6.1-Sol"], ["gpt-6-luna", "GPT-6-Luna"]],
    claude: [["opus", "Opus 5.5"], ["sonnet", "Sonnet 5.5"]],
    opencode: [["kimi-k3", "Kimi K3"], ["deepseek-v4.1", "DeepSeek V4.1 Flash"]],
  };
  const handlers = {
    "plugin:event|listen": ({ event, handler }) => { listeners.set(handler, event); return handler; },
    "plugin:event|unlisten": () => null,
    // Same contract as native (ADR-048): metadata only, transcripts through transcript_action.
    load_state: () => clone({ projects, sessions: sessions.map((s) => ({ ...s, messages: [], transcriptLength: s.messages.filter((m) => m.role !== "system").length })), settings, composerDrafts: {}, contextTexts: {} }),
    transcript_action: ({ action }) => {
      if (action.type === "load") return { type: "transcript", sessionId: action.sessionId, messages: clone(sessions.find((s) => s.id === action.sessionId)?.messages ?? []) };
      if (action.type === "search") {
        const needle = action.query.trim().toLowerCase();
        return { type: "candidates", truncated: false, sessions: sessions.map((s) => ({ sessionId: s.id, messages: clone(s.messages.filter((m) => m.role !== "system" && m.content.toLowerCase().includes(needle))) })).filter((c) => c.messages.length) };
      }
      return null;
    },
    open_project: ({ projectId }) => projects.find((p) => p.id === projectId),
    detect_agents: () => installs,
    list_provider_models: ({ id }) => ({ provider: id, source: "cli", note: "", models: (catalogs[id] ?? []).map(([mid, displayName]) => ({ id: mid, displayName, availability: "available" })) }),
    git_identity: ({ path }) => ({ isRepo: true, root: path, branch: "main", detached: false }),
    git_status: () => ({ identity: { isRepo: true, root: "/Users/demo/atlas", branch: "main", detached: false }, dirty: false, ahead: 0, behind: 0, changes: [] }),
    list_branches: () => [{ name: "main", current: true }],
    save_settings: ({ settings: next }) => next,
    provider_usage: ({ provider }) => ({ provider, status: "available", updatedAt: now, note: null, account: { email: null, name: null, plan: "Pro", keyFingerprint: null }, resetCount: 0, resetOffer: null,
      windows: [{ id: "primary", usedPercent: provider === "claude" ? 41 : 23, resetsAt: now + 3.2 * 3600e3, durationMinutes: 300 }, { id: "secondary", usedPercent: 12, resetsAt: now + 4.5 * 86400e3, durationMinutes: 10080 }] }),
    computer_action: () => ({ supported: true, enabled: false, accessibility: true, screenRecording: true, requests: [], grants: [], history: [], blocked: [] }),
    create_session: ({ request }) => {
      const created = session("ratelimit", request.projectId ?? "atlas", pt ? "Limitar tentativas de login" : "Rate-limit the login API", request.agent ?? "codex", request.model ?? "gpt-6.1-sol", "idle", [], 1000);
      sessions.unshift(created);
      return clone(created);
    },
    send_prompt: ({ request }) => {
      const target = sessions.find((s) => s.id === request.sessionId);
      target.status = "running";
      target.messages.push(message("u-new", "user", request.prompt, { sessionId: target.id, ago: 0 }));
      target.messages.push(message("a-new", "agent", "", { sessionId: target.id, ago: 0, streaming: true, activity: activity(target.agent, target.model, "running", [], 0) }));
      setTimeout(() => playTurn(target), 50);
      return clone(target);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback: (cb) => { const id = ++callbackId; window[`_${id}`] = cb; return id; },
    unregisterCallback: () => {},
    invoke: async (cmd, args = {}) => { (window.__demoCalls ??= []).push(cmd); return handlers[cmd] ? handlers[cmd](args) : null; },
  };
})();
