const modes = [{ theme: "dark", glass: false, label: "Dark sólido" }, { theme: "light", glass: false, label: "Light sólido" }, { theme: "dark", glass: true, label: "Dark + vidro" }, { theme: "light", glass: true, label: "Light + vidro" }];
const $ = id => document.getElementById(id);
const comparison = $("comparison");
let theme = "dark", glass = false;
const dialog = $("dialog");
for (const mode of modes) {
  const card = document.createElement("article");
  card.className = "sample";
  card.dataset.theme = mode.theme;
  card.dataset.glass = String(mode.glass);
  card.innerHTML = `<div class="sample-scene"><div class="popup"><span class="popup-label">NOVA SESSÃO</span><div class="menu-row current"><span>Workspace local</span><span class="check">✓</span></div><div class="menu-row">Novo worktree</div><div class="separator"></div><div class="menu-row">Perguntar sempre</div></div></div><div class="sample-footer"><button class="choose">${mode.label} ↗</button><span class="sample-note">${mode.glass ? "Vidro" : "Sólido"}</span></div>`;
  card.querySelector("button").addEventListener("click", () => { theme = mode.theme; glass = mode.glass; update(); $("stage").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" }); });
  comparison.append(card);
}
function closePopups() { for (const [trigger, content] of [["provider-trigger", "provider-menu"], ["popover-trigger", "session-popover"]]) { $(content).hidden = true; $(trigger).setAttribute("aria-expanded", "false"); } }
function update() {
  for (const element of [$("stage"), dialog]) { element.dataset.theme = theme; element.dataset.glass = String(glass); element.style.setProperty("--opacity", `${$("opacity").value}%`); }
  $("dark").setAttribute("aria-pressed", String(theme === "dark")); $("light").setAttribute("aria-pressed", String(theme === "light"));
  $("glass").checked = glass; $("opacity").disabled = !glass; $("opacity-value").value = `${$("opacity").value}%`;
  $("mode-label").textContent = `${theme === "dark" ? "Dark" : "Light"} · ${glass ? "Translúcido" : "Sólido"}`;
  for (const card of comparison.children) card.classList.toggle("active", card.dataset.theme === theme && card.dataset.glass === String(glass));
}
for (const value of ["dark", "light"]) $(value).addEventListener("click", () => { theme = value; update(); });
$("glass").addEventListener("change", event => { glass = event.target.checked; update(); });
$("opacity").addEventListener("input", update);
for (const [trigger, content] of [["provider-trigger", "provider-menu"], ["popover-trigger", "session-popover"]]) {
  $(trigger).addEventListener("click", () => { const open = $(content).hidden; closePopups(); $(content).hidden = !open; $(trigger).setAttribute("aria-expanded", String(open)); if (open) $(content).querySelector("button")?.focus(); });
}
$("provider-menu").addEventListener("click", event => { const button = event.target.closest("[data-provider]"); if (!button) return; $("selection").textContent = `Provedor selecionado na prévia: ${button.dataset.provider}.`; for (const row of $("provider-menu").querySelectorAll("[data-provider]")) { row.classList.toggle("current", row === button); row.querySelector(".check")?.remove(); } const check = document.createElement("span"); check.className = "check"; check.textContent = "✓"; button.append(check); closePopups(); $("provider-trigger").focus(); });
$("dialog-trigger").addEventListener("click", () => { closePopups(); dialog.showModal(); });
for (const id of ["close-dialog", "cancel-dialog", "confirm-dialog"]) $(id).addEventListener("click", () => { dialog.close(); $("dialog-trigger").focus(); });
document.addEventListener("click", event => { if (!event.target.closest(".anchor")) closePopups(); });
document.addEventListener("keydown", event => { if (event.key === "Escape") { const opened = !$("provider-menu").hidden ? "provider-trigger" : !$("session-popover").hidden ? "popover-trigger" : null; closePopups(); if (opened) { event.preventDefault(); $(opened).focus(); } } });
update();
