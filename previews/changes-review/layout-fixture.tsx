// Disposable transcript/sidebar regression fixture: no native host or real files.
import { createRoot } from "react-dom/client";
import { SessionPane } from "@/components/SessionPane";
import { RightDock } from "@/components/RightDock";
import { useEffect } from "react";
import { createShortcutController } from "@/lib/shortcuts";
import { effectiveShortcut } from "@/lib/keybindings";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { Sidebar } from "@/components/Sidebar";
import { TooltipProvider } from "@/primitives/Tooltip";
import { observePromptQueue, selectCurrentSession, useAppStore } from "@/store/app-store";
import { queueBinding } from "@/lib/prompt-queue";
import { applyAppearance, mergeSettings } from "@/lib/settings";
import { isConversationStarted } from "@/lib/appearance";
import { client } from "@/client";
import type { Message, Session } from "@/client/types";
import "./layout-fixture.css";
import { configureDynamicStyleNonce } from "@/lib/editor-nonce";

client.dictationStatus = async () => "unsupported";
client.stopDictation = async () => "";
client.saveComposerDraft = async () => undefined;
const timestamp = "2026-10-02T16:00:00Z";
let sequence = 0;
const message = (role: Message["role"], content: string): Message => ({ id: `fixture-${++sequence}`, sessionId: "fixture", role, content, createdAt: timestamp, streaming: false });
const initial: Session = { id: "fixture", projectId: "owned", title: "Layout de exemplo", agent: "codex", model: "gpt-6-luna", status: "completed", worktree: { path: "/fixture", branch: "main", isolated: false }, createdAt: timestamp, lastActivityAt: timestamp, lastError: null, messages: [message("user", "Mensagem anterior"), message("agent", "Histórico anterior.\n".repeat(45)), message("user", "Mensagem inicial"), message("agent", "Resposta curta.")] };
const state = useAppStore.getState();
const outlinePreview = new URLSearchParams(window.location.search).has("outline");
if (outlinePreview) {
  initial.messages = [
    ["Como funciona o projeto?", "O Sirus Code organiza projetos, sessões, agentes e worktrees. Cada sessão conserva seu próprio histórico."],
    ["Adicionar sugestões de skills com /", "As sugestões aparecem no composer. As setas navegam, Enter seleciona e Escape fecha a lista."],
    ["Quero mencionar os arquivos com @", "O menu usa os arquivos do workspace da sessão. Selecionar um arquivo insere sua referência no pedido."],
    ["Abrir PDF, DOCX e planilhas no painel lateral", "Os anexos abrem no painel lateral. Você pode consultar o documento e continuar lendo a conversa."],
    ["Mudar o resumo para lista compacta", "A lista apresenta os arquivos alterados e os botões Manter e Revisar."],
    ["Mostrar a atividade do provedor", "Durante o trabalho, o indicador exibe a atividade e o tempo do turno."],
    ["Adicionar os tópicos clicáveis à esquerda", "Cada traço representa um pedido. Passe o mouse para consultar a prévia ou clique para voltar à mensagem.\n\n".repeat(8)],
    ["Consigo usar pelo teclado?", "Sim. Tab entra no índice; as setas percorrem os tópicos, Home e End vão às extremidades, e Enter abre a mensagem."],
  ].flatMap(([request, response]) => [message("user", request), message("agent", response)]);
}
const reviewTools = new URLSearchParams(window.location.search).has("review-tools");
if (reviewTools) {
  initial.messages = [message("user", "Corrija o login"), message("agent", "Ajustei o retorno do login.\n```ts\nfunction login() {\n  return user ?? null;\n}\n```\nVocê pode comentar as linhas no Review.")];
  initial.messages[1].activity = { provider: "codex", model: "gpt-6-luna", startedAt: 0, endedAt: 1000, waitingSince: null, pausedMs: 0, status: "completed", items: [], truncated: false, review: { files: [{ path: "src/login.ts", kind: "modified", additions: 1, deletions: 1, binary: false, diff: "--- a/src/login.ts\n+++ b/src/login.ts\n@@ -10,2 +10,2 @@\n const user = read();\n-return user;\n+return user ?? null;\n" }], partial: false, sharedWorkspace: false, keptAt: null, expired: false } };
}
useAppStore.setState({ projects: [{ id: "owned", name: "Projeto de exemplo", path: "/fixture", addedAt: timestamp, lastOpenedAt: timestamp }], sessions: [initial], selectedProjectId: "owned", selectedSessionId: "fixture", mainView: "session", sidebarCollapsed: false, settings: { ...state.settings, animations: false, reduceMotion: true, locale: "pt-BR" }, composerDrafts: { "session:fixture": "Rascunho local" }, refreshProviderUsage: async () => undefined, saveSettings: async settings => { useAppStore.setState({ settings }); }, selectProject: async id => { useAppStore.setState({ selectedProjectId: id }); } });
if (outlinePreview) useAppStore.setState({ sidebarCollapsed: true });
if (reviewTools) useAppStore.setState({ sidebarCollapsed: true, dockWidth: 480, refreshGitStatus: async () => undefined, sessions: [initial, { ...initial, id: "fixture-other", title: "Outra conversa", messages: [{ ...message("user", "Como testar o login?"), sessionId: "fixture-other" }] }] });
const showMode = (mode: "conversation" | "new" | "handoff") => {
  const handoff: Session = { ...initial, messages: [], status: "idle", handoff: { from: "claude", brief: "Resumo de exemplo", request: "Continuar o trabalho", pending: true } };
  useAppStore.setState({ sessions: [mode === "handoff" ? handoff : initial], selectedSessionId: mode === "new" ? null : "fixture", selectedProjectId: mode === "new" ? null : "owned" });
};
const queuePreview = new URLSearchParams(window.location.search).has("queue");
function queueSnapshot(next: Session) {
  useAppStore.setState({ sessions: [next] });
  observePromptQueue(next);
}
function settleQueue(status: "completed" | "failed" | "stopped") {
  const current = useAppStore.getState().sessions[0];
  queueSnapshot({ ...current, status, messages: current.messages.map(row => ({ ...row, streaming: false })) });
}
if (queuePreview) {
  const current = { ...initial, status: "running" as const, messages: [message("user", "Crie a tela de login"), { ...message("agent", "Estou preparando a tela de login. Use o campo abaixo para adicionar os próximos pedidos à fila."), streaming: true }] };
  const contexts = { attachments: [], goal: "", planning: false };
  useAppStore.setState({ sessions: [current], selectedProjectId: "owned", selectedSessionId: "fixture", agents: [{ id: "codex", installed: true, path: "/fixture/codex", version: "fixture" }], composerDrafts: {}, composerContexts: {}, promptQueues: { fixture: { paused: false, waitingFor: current.messages[current.messages.length - 1].id, items: ["Depois, adicione a recuperação de senha.", "Por último, verifique o fluxo pelo teclado."].map((text, index) => ({ id: `queue-${index}`, text, prompt: text, context: contexts, execution: { approval: "ask" }, binding: queueBinding(current) })) } } });
  client.sendPrompt = async request => {
    const current = useAppStore.getState().sessions[0];
    const next = { ...current, status: "running" as const, messages: [...current.messages, message("user", request.prompt), { ...message("agent", "Pedido iniciado. Neste preview, clique em Concluir pedido atual para avançar a fila."), streaming: true }] };
    queueSnapshot(next);
    return next;
  };
  client.stopAgent = async () => settleQueue("stopped");
  client.releasePromptAttachments = async () => undefined;
}
const materialModes = ["dark", "light", "dark-sidebar", "light-sidebar", "dark-window", "light-window"] as const;
const material = (mode: (typeof materialModes)[number]) => applyAppearance(mergeSettings({ theme: mode.startsWith("light") ? "light" : "dark", darkSidebarTranslucent: mode === "dark-sidebar", lightSidebarTranslucent: mode === "light-sidebar", darkWindowTranslucent: mode === "dark-window", lightWindowTranslucent: mode === "light-window" }), { translucency: true, dockIcon: true });
material("dark");
const edit = (transform: (session: Session) => Session) => useAppStore.setState(previous => ({ sessions: previous.sessions.map(transform) }));
const send = () => edit(session => ({ ...session, messages: [...session.messages, message("user", `Nova mensagem ${sequence}`), message("agent", "Resposta curta.")] }));
function Fixture() {
  useEffect(() => {
    const listener = createShortcutController(() => (["find-in-conversation", "search-conversations"] as const).map(id => ({ id, combo: effectiveShortcut(useAppStore.getState().settings.customShortcuts, id), when: () => !useAppStore.getState().settingsOpen, run: () => useAppStore.getState().openTranscriptSearch(id === "find-in-conversation" ? "session" : "all") })));
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const session = useAppStore(selectCurrentSession);
  const collapsed = useAppStore(state => state.sidebarCollapsed);
  const settingsOpen = useAppStore(state => state.settingsOpen);
  const dockOpen = useAppStore(state => state.dockOpen);
  return <TooltipProvider>{queuePreview && <nav className="flex h-10 items-center gap-3 px-4 ui-control"><span>Preview da fila · sem provedor real</span><button onClick={() => settleQueue("completed")}>Concluir pedido atual</button><button onClick={() => settleQueue("failed")}>Simular falha</button></nav>}<nav style={{ display: queuePreview ? "none" : "flex", gap: 16, height: 40 }}><button data-action="send" onClick={send}>Simular admissão</button><button data-action="grow" onClick={() => edit(session => ({ ...session, messages: session.messages.map((row, index) => index === session.messages.length - 1 ? { ...row, content: row.content + "Resposta em progresso.\n".repeat(70), streaming: true } : row) }))}>Simular saída</button><button data-action="short-answer" onClick={() => edit(session => ({ ...session, messages: [...session.messages, message("agent", "Resposta final curta.")] }))}>Resposta final</button><button data-action="settle" onClick={() => edit(session => ({ ...session, messages: session.messages.map(row => ({ ...row, streaming: false })) }))}>Concluir</button><button data-action="jump" onClick={() => useAppStore.getState().jumpToMessage("fixture", initial.messages[0].id)}>Ir ao histórico</button><button data-action="jump-latest" onClick={() => { const last = useAppStore.getState().sessions[0].messages; useAppStore.getState().jumpToMessage("fixture", last[last.length - 1].id); }}>Ir à última resposta</button><button data-action="collapse" onClick={() => useAppStore.setState({ sidebarCollapsed: !collapsed })}>Recolher</button></nav><nav style={{ display: queuePreview ? "none" : "flex", gap: 12, height: 40 }}>{["conversation", "new", "handoff"].map(mode => <button key={mode} data-mode={mode} onClick={() => showMode(mode as "conversation" | "new" | "handoff")}>{mode}</button>)}{materialModes.map(mode => <button key={mode} data-material={mode} onClick={() => material(mode)}>{mode}</button>)}<button data-action="inset" onClick={() => document.querySelector<HTMLElement>("[data-chat-container]")!.style.paddingRight = "312px"}>Ambiente</button></nav><div data-settings-open={settingsOpen} className="app-material relative flex" style={{ height: 720 }}><div aria-hidden="true" className="app-content-frame"/><div style={{ width: collapsed ? 52 : 372, flexShrink: 0 }}><Sidebar/></div><main className={`${isConversationStarted(session) ? "sidebar-material" : "main-material"} flex min-h-0 min-w-0 flex-1 flex-col`}><header style={{ height: "var(--window-controls-height)", flexShrink: 0 }}/><div data-chat-container className="relative flex min-h-0 flex-1"><SessionPane session={session} agents={[]} onSend={queuePreview ? useAppStore.getState().sendPrompt : async () => false} onStop={queuePreview ? () => void useAppStore.getState().stopAgent() : () => undefined} onNewSession={() => undefined}/>{dockOpen && <div style={{ width: 480, flexShrink: 0 }}><RightDock/></div>}</div></main></div>{settingsOpen && <SettingsPage/>}</TooltipProvider>;
}
configureDynamicStyleNonce(document);
createRoot(document.getElementById("root")!).render(<Fixture/>);
