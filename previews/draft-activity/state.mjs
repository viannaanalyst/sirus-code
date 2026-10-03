export const sessions = [
  { id: "interface", title: "Ajustar a interface", provider: "codex", model: "gpt-6-luna", icon: "openai", mono: true, time: "agora" },
  { id: "browser", title: "Revisar o navegador", provider: "opencode", model: "opencode-go/deepseek-v4.1-flash", icon: "deepseek", mono: false, time: "12 min" },
  { id: "appearance", title: "Detalhes da aparência", provider: "opencode", model: "opencode-go/kimi-k3", icon: "kimi", mono: true, time: "1 h" },
  { id: "shortcuts", title: "Atalhos de teclado", provider: "claude", model: "claude/claude-sonnet-5", icon: "claude", mono: false, time: "2 h" },
];
export const modelLabel = (id) => id.slice(id.lastIndexOf("/") + 1);
export function createPreviewState() {
  return { active: "interface", variant: "inline", drafts: { browser: "Também confira o comportamento dos botões ao abrir o navegador.", appearance: "Quero revisar o contraste dos popups no tema claro." } };
}
export function hasDraft(state, id) { return Boolean(state.drafts[id]?.trim()); }
export function setDraft(state, value) {
  if (value.trim()) state.drafts[state.active] = value;
  else delete state.drafts[state.active];
}
export function selectSession(state, id) {
  if (!sessions.some(session => session.id === id)) throw new Error("Unknown preview session");
  state.active = id;
  return state.drafts[id] ?? "";
}
export function sessionGroups(state) {
  if (state.variant === "inline") return [{ name: "Projeto · switchyard", rows: sessions }];
  const drafts = sessions.filter(session => hasDraft(state, session.id));
  return [ ...(drafts.length ? [{ name: "Rascunhos", rows: drafts }] : []),
    { name: "Recentes", rows: sessions.filter(session => !hasDraft(state, session.id)) } ];
}
