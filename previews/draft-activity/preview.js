import { sessions, modelLabel, createPreviewState, hasDraft, setDraft, selectSession, sessionGroups } from "./state.mjs";
let state = createPreviewState();
const root = document.documentElement;
const textarea = document.querySelector("#composer");
const threads = document.querySelector("#threads");
const feedback = document.querySelector("#feedback");
const pencil = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5M4 20l4-1L21 6a2.8 2.8 0 0 0-4-4L4 15l-1 6z"/></svg>';
const media = matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const selected = document.querySelector('input[name="theme"]:checked').value;
  root.dataset.theme = selected === "system" ? media.matches ? "dark" : "light" : selected;
}
media.addEventListener("change", applyTheme);
document.querySelectorAll('input[name="theme"]').forEach(input => input.addEventListener("change", applyTheme));
document.querySelector("#glass").addEventListener("change", event => { root.dataset.glass = event.target.checked ? "on" : "off"; });
function renderThreads() {
  const focusedId = threads.contains(document.activeElement) ? document.activeElement.dataset.id : null;
  threads.replaceChildren();
  for (const group of sessionGroups(state)) {
    const heading = document.createElement("h3"); heading.textContent = group.name; threads.append(heading);
    for (const session of group.rows) {
      const row = document.createElement("button"); row.type = "button"; row.className = "thread";
      row.dataset.id = session.id; row.setAttribute("aria-current", session.id === state.active ? "page" : "false");
      const icon = document.createElement("img"); icon.src = `assets/${session.icon}.svg`; icon.alt = ""; icon.className = session.mono ? "mono" : "";
      const text = document.createElement("span"); text.className = "thread-copy";
      const title = document.createElement("span"); title.className = "thread-title"; title.textContent = session.title;
      const metadata = document.createElement("span"); metadata.className = "thread-meta"; metadata.textContent = `sirus · ${session.time}`;
      text.append(title, metadata); row.append(icon, text);
      if (hasDraft(state, session.id)) {
        const glyph = document.createElement("span"); glyph.className = "pencil"; glyph.innerHTML = pencil;
        glyph.setAttribute("role", "img"); glyph.setAttribute("aria-label", "Rascunho não enviado"); glyph.title = "Rascunho não enviado"; row.append(glyph);
      }
      row.addEventListener("click", () => {
        textarea.value = selectSession(state, session.id); renderSelection(); renderThreads();
        feedback.textContent = hasDraft(state, session.id) ? "Seu texto não enviado foi recuperado nesta sessão." : "Esta sessão não tem texto por enviar.";
      });
      threads.append(row);
    }
  }
  const count = sessions.filter(session => hasDraft(state, session.id)).length;
  document.querySelector("#draft-count").textContent = `${count} ${count === 1 ? "rascunho" : "rascunhos"}`;
  if (focusedId) threads.querySelector(`[data-id="${focusedId}"]`)?.focus();
}
function renderSelection() {
  const session = sessions.find(session => session.id === state.active);
  document.querySelector("#session-title").textContent = session.title;
  const icon = document.querySelector("#model-icon"); icon.src = `assets/${session.icon}.svg`; icon.className = session.mono ? "mono" : "";
  document.querySelector("#model-name").textContent = modelLabel(session.model);
  document.querySelector("#send").disabled = !hasDraft(state, state.active);
  document.querySelector("#clear").disabled = !hasDraft(state, state.active);
}
textarea.addEventListener("input", () => {
  setDraft(state, textarea.value); renderThreads(); renderSelection();
  feedback.textContent = hasDraft(state, state.active) ? "Rascunho guardado nesta simulação. Troque de sessão para testar." : "O lápis desaparece quando não há texto por enviar.";
});
document.querySelectorAll('input[name="variant"]').forEach(input => input.addEventListener("change", () => {
  state.variant = input.value; renderThreads();
  document.querySelector("#variant-note").textContent = input.value === "inline" ? "01 mantém as sessões nos projetos atuais. O lápis aparece à direita só quando há texto por enviar." : "02 reúne as sessões com texto não enviado em Rascunhos. Cada sessão aparece uma única vez.";
}));
document.querySelector("#activity-toggle").addEventListener("click", event => {
  const button = event.currentTarget; const expanded = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(expanded)); document.querySelector("#activity-details").hidden = !expanded;
});
for (const id of ["clear", "send"]) document.querySelector(`#${id}`).addEventListener("click", () => {
  setDraft(state, ""); textarea.value = ""; renderSelection(); renderThreads();
  feedback.textContent = id === "send" ? "Envio simulado: o lápis desapareceu. Nenhum modelo foi acionado." : "Rascunho removido desta sessão.";
});
document.querySelector("#reset").addEventListener("click", () => {
  const variant = state.variant; state = createPreviewState(); state.variant = variant;
  textarea.value = ""; renderSelection(); renderThreads(); feedback.textContent = "Exemplo reiniciado com dois rascunhos.";
});
applyTheme(); renderSelection(); renderThreads();
