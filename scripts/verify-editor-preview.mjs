// Optional browser regression against only the built, isolated fixture preview.
// Usage: node scripts/verify-editor-preview.mjs /path/to/chrome-headless-shell
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, extname, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const binary = process.argv[2];
assert.ok(binary, "Pass an installed headless Chromium binary; this check never downloads one");
const root = resolve("previews/changes-review/dist");
const nonce = "isolated-editor-regression";
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff" };
const http = createServer(async (request, response) => {
  try {
    const path = resolve(root, `.${new URL(request.url, "http://localhost").pathname === "/" ? "/index.html" : new URL(request.url, "http://localhost").pathname}`);
    if (!path.startsWith(`${root}${sep}`)) { response.writeHead(403).end(); return; }
    let body = await readFile(path);
    if (path.endsWith(".html")) body = Buffer.from(body.toString().replace("<style>", `<style nonce="${nonce}">`));
    // This fixture also mounts the existing composer. Its pinned shader package
    // eagerly adds one fixed vendor stylesheet; admit only that hash, never arbitrary inline CSS.
    const shaderStyle = path.endsWith("layout-fixture.html") ? " 'sha256-bcX2M6hOeEgeI9Ttj3KtXWZuoRsKenyQAlXswSnLakA='" : "";
    response.writeHead(200, {
      "Content-Type": mime[extname(path)] ?? "application/octet-stream",
      "Content-Security-Policy": `default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${nonce}'${shaderStyle}; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'`,
    }).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => http.listen(0, "127.0.0.1", resolve));
const profile = await mkdtemp(join(tmpdir(), "sirus-editor-regression-"));
const chrome = spawn(binary, ["--headless", "--disable-gpu", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--window-size=1500,1050", "about:blank"], { stdio: "ignore" });
let socket;
const pending = new Map(), errors = [];
let id = 0;
try {
  let port;
  for (let i = 0; i < 100 && !port; i++) { try { port = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); } catch { await delay(100); } }
  assert.ok(port, "Headless browser must start");
  const target = await (await globalThis.fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  socket = new globalThis.WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id) { const request = pending.get(message.id); pending.delete(message.id); if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result); }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") errors.push(message.params.entry.text);
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => { const requestId = ++id; pending.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ id: requestId, method, params })); });
  const evaluate = async expression => { const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; };
  const settle = () => evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const waitFor = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(50); } throw new Error(`Missing fixture state: ${expression}`); };
  const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); };
  const button = async text => { await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`); await settle(); };
  await command("Runtime.enable"); await command("Log.enable"); await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1050, deviceScaleFactor: 1, mobile: false });
  await command("Page.navigate", { url: `http://127.0.0.1:${http.address().port}/` });
  await waitFor("!!document.querySelector('.summary-toggle')");
  assert.equal(await evaluate("!!document.querySelector('.change-summary.variant-2') && !document.querySelector('.file-rows')"), true);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.user-actions')).opacity"), "0");
  const bubble = await evaluate("(() => { const r = document.querySelector('.user-message').getBoundingClientRect(); return {x:r.x+20,y:r.y+20}; })()");
  await command("Input.dispatchMouseEvent", {type:"mouseMoved", ...bubble}); await settle();
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.user-actions')).opacity"), "1");
  await command("Input.dispatchMouseEvent", {type:"mouseMoved", x:0, y:0}); await settle();
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.user-actions')).opacity"), "0");
  await evaluate("document.querySelector('.user-actions button').focus()");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.user-actions')).opacity"), "1");
  await evaluate("document.activeElement.blur()");
  await click(".summary-toggle");
  await waitFor("document.querySelectorAll('.file-row').length === 5");
  await click(".more-files"); assert.equal(await evaluate("document.querySelectorAll('.file-row').length"), 6);
  await click(".file-row"); assert.equal(await evaluate("document.querySelector('.file-heading').textContent.includes('page.tsx')"), true);
  await click(".mode-button"); assert.equal(await evaluate("!!document.querySelector('.unified-diff')"), true);
  await click(".mode-button"); assert.equal(await evaluate("!!document.querySelector('.split-diff')"), true);
  await writeFile(join(profile, "diff.png"), Buffer.from((await command("Page.captureScreenshot", { format: "png" })).data, "base64"));
  if (process.argv.includes("--without-editor-nonce")) await evaluate("document.querySelector('style[nonce]').removeAttribute('nonce')");
  await button("Editar exemplo"); await waitFor("!!document.querySelector('.cm-content[contenteditable=true]')");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.cm-scroller')).display"), "flex", "CodeMirror style modules must pass nonce CSP");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.cm-gutters')).display"), "flex");
  assert.ok(await evaluate("[...document.querySelectorAll('head style')].filter(style => style.nonce === 'isolated-editor-regression').length >= 2"));
  const positions = await evaluate("({line:document.querySelector('.cm-line').getBoundingClientRect().y,gutter:[...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].find(element=>element.textContent==='1').getBoundingClientRect().y})");
  assert.ok(Math.abs(positions.line - positions.gutter) <= 2, "Code and line number must align");
  await evaluate("document.querySelector('.cm-content').focus()");
  await command("Input.insertText", { text: "// manual edit\n" }); await settle();
  assert.equal(await evaluate("document.querySelector('.panel-tools').textContent.includes('Não salvo')"), true);
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "s", code: "KeyS", modifiers: process.platform === "darwin" ? 4 : 2 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "s", code: "KeyS" }); await settle();
  assert.equal(await evaluate("document.querySelector('.panel-tools').textContent.includes('Salvo em memória')"), true);
  await command("Input.insertText", { text: "// pending text\n" }); await settle();
  await click("[aria-label='Fechar painel']"); await waitFor("!!document.querySelector('[role=dialog]')");
  await button("Cancelar"); await delay(200);
  assert.equal(await evaluate("document.querySelector('.cm-content').textContent.includes('pending text')"), true);
  await button("Claro"); assert.equal(await evaluate("document.documentElement.dataset.theme"), "light");
  await click(".palette input"); await click("[aria-label='Fechar painel']"); await waitFor("!!document.querySelector('[role=dialog]')");
  assert.equal(await evaluate("document.documentElement.dataset.popupGlass"), "on");
  const popup = await evaluate("({html:document.querySelector('[role=dialog]').outerHTML.slice(0,650),filter:getComputedStyle(document.querySelector('[role=dialog]')).backdropFilter,glass:document.documentElement.dataset.popupGlass,blur:getComputedStyle(document.documentElement).getPropertyValue('--material-blur')})");
  assert.equal(popup.filter.includes("blur"), true, JSON.stringify(popup));
  await button("Descartar"); await delay(200);
  await button("Testar editor Markdown"); await waitFor("!!document.querySelector('.cm-content')");
  await button("Prévia"); assert.equal(await evaluate("!!document.querySelector('.editor-area h1')"), true);
  await button("Código"); await waitFor("!!document.querySelector('.cm-content')");
  await click("[aria-label='Fechar painel']");
  await button("Simular em execução"); assert.equal(await evaluate("!!document.querySelector('.change-summary')"), false);
  await button("Simular conclusão");
  await button("01 · Lista compacta");
  await click(".summary-actions button"); await waitFor("!!document.querySelector('[role=dialog]')");
  await button("Desfazer arquivos"); await delay(200);
  assert.equal(await evaluate("!!document.querySelector('.user-message') && !!document.querySelector('.change-summary.undone')"), true);
  await button("Reiniciar exemplo");
  await button("02 · Card de revisão"); await button("Manter"); assert.equal(await evaluate("document.querySelector('.summary-actions').textContent.includes('Mantidas')"), true);
  await button("03 · Linha discreta"); assert.equal(await evaluate("!!document.querySelector('.file-rows')"), false);
  await click(".summary-toggle"); assert.equal(await evaluate("!!document.querySelector('.file-rows')"), true);
  await click("[aria-label='Voltar a esta mensagem']"); await waitFor("!!document.querySelector('[role=dialog]')");
  await button("Voltar à mensagem"); await delay(200);
  assert.equal(await evaluate("!!document.querySelector('.change-summary') || !!document.querySelector('.user-message')"), false);
  assert.equal(await evaluate("document.querySelector('textarea').value.startsWith('Melhore')"), true);
  await command("Page.navigate", { url: `http://127.0.0.1:${http.address().port}/layout-fixture.html` });
  await waitFor("!!document.querySelector('[data-latest-turn] article')"); await settle();
  if (process.argv.includes("--without-turn-reserve")) await evaluate("document.querySelector('style[nonce]').textContent += '[data-latest-turn] { min-height: 0 !important; }'");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('[role=region]')).scrollbarWidth"), "none");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('[role=region]'), '::-webkit-scrollbar').display"), "none");
  assert.equal(await evaluate("!!document.querySelector('[data-section=projects]')"), false);
  const geometry = () => evaluate("(() => { const v=document.querySelector('[role=region]'), a=document.querySelector('[data-latest-turn] article'); return {top:a.getBoundingClientRect().top-v.getBoundingClientRect().top,padding:parseFloat(getComputedStyle(v).paddingTop),scroll:v.scrollTop,end:v.scrollHeight-v.scrollTop-v.clientHeight,height:v.clientHeight}; })()");
  await writeFile("/tmp/sirus-layout-fixture.png", Buffer.from((await command("Page.captureScreenshot", { format: "png" })).data, "base64"));
  let position = await geometry();
  assert.ok(Math.abs(position.top - position.padding) <= 2, JSON.stringify(position));
  await click("[data-action=send]"); position = await geometry();
  assert.ok(Math.abs(position.top - position.padding) <= 2, "Each newly admitted user message must sit at viewport top");
  await click("[data-action=settle]"); assert.equal((await geometry()).scroll, position.scroll);
  await evaluate("document.querySelector('[role=region]').style.maxHeight='320px'"); await settle();
  position = await geometry(); assert.ok(Math.abs(position.top-position.padding)<=2, "Composer/viewport resize keeps short turn anchored");
  await click("[data-action=grow]"); position = await geometry();
  assert.ok(position.end < 2 && position.top < 0, "Long output transfers to end-follow without permanent blank space");
  await evaluate("document.querySelector('[role=region]').scrollTop=200"); await settle(); await delay(50);
  const manual = (await geometry()).scroll;
  await click("[data-action=grow]"); assert.ok(Math.abs((await geometry()).scroll-manual)<=2, "Output does not steal manual history scrolling");
  await click("[data-action=send]"); position = await geometry();
  assert.ok(Math.abs(position.top-position.padding)<=2, "New send reanchors even after history detachment");
  await click("[data-action=grow]"); await click("[data-action=short-answer]");
  await click("[data-action=jump-latest]"); await delay(60); const bookmarked = (await geometry()).scroll;
  assert.ok((await geometry()).end < 48, "Bookmark regression exercises a jump clamped near the end");
  await click("[data-action=grow]"); await delay(60);
  assert.ok(Math.abs((await geometry()).scroll-bookmarked)<=2, "Programmatic near-end bookmark remains detached as output grows");
  await click("[data-action=jump]"); assert.equal(await evaluate("document.activeElement.tagName"), "ARTICLE");
  await click("[data-action=send]"); position = await geometry(); assert.ok(Math.abs(position.top-position.padding)<=2);
  assert.equal(await evaluate("!!document.querySelector('.sidebar-project-group') && !!document.querySelector('.sidebar-panel-header [aria-label=Rascunhos]')"), true);
  assert.equal(await evaluate("!!document.querySelector('.sidebar-panel-footer')"), false);
  assert.equal(await evaluate("document.querySelectorAll('.sidebar-panel-header button').length"), 2);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.sidebar-rail-button')).width"), "32px");
  assert.equal(await evaluate("document.querySelector('.sidebar-rail-button svg').getAttribute('width')"), "14");
  assert.equal(await evaluate("!!document.querySelector('.sidebar-scope,.sidebar-section-heading,.sidebar-activity-second,.sidebar-project-hint')"), false);
  assert.equal(await evaluate("[...document.querySelectorAll('.sidebar-session-open')].every(row => !row.querySelector('.sidebar-folder-glyph,.lucide-git-branch,.lucide-git-compare-arrows'))"), true);
  const usageGeometry = () => evaluate("(() => {const c=document.querySelector('.agent-composer').getBoundingClientRect(),f=document.querySelector('footer').getBoundingClientRect(); return {left:f.left-c.left,right:f.right-c.right,under:f.top>=c.bottom};})()");
  const aligned = async () => { const row = await usageGeometry(); assert.ok(Math.abs(row.left)<=1 && Math.abs(row.right)<=1 && row.under, JSON.stringify(row)); };
  await aligned();
  await click("[data-action=inset]"); await aligned();
  await evaluate("document.querySelector('[data-chat-container]').style.paddingRight=''"); await settle();
  const hoverSession = async () => {
    const point = await evaluate("(() => {const r=document.querySelector('.sidebar-session-open').getBoundingClientRect();return {x:r.x+60,y:r.y+r.height/2};})()");
    await command("Input.dispatchMouseEvent", {type:"mouseMoved", ...point});
    await waitFor("!!document.querySelector('.sidebar-hover-card')");
    await command("Input.dispatchMouseEvent", {type:"mousePressed", button:"right", clickCount:1, ...point});
    await command("Input.dispatchMouseEvent", {type:"mouseReleased", button:"right", clickCount:1, ...point});
    await waitFor("!!document.querySelector('[role=menu]')"); await settle();
    assert.equal(await evaluate("!!document.querySelector('.sidebar-hover-card')"), false, "Opening session actions dismisses the hover card");
  };
  await hoverSession();
  await evaluate("[...document.querySelectorAll('[role=menuitem]')].find(row => row.textContent.includes('Excluir sessão')).click()"); await settle();
  await waitFor("!!document.querySelector('[role=dialog] button[type=submit]')"); await delay(150);
  assert.equal(await evaluate("!!document.querySelector('.sidebar-hover-card')"), false, "Delete dialog focus must not reopen the session card");
  const deletion = await evaluate("(() => {const d=document.querySelector('[role=dialog]'),b=d.querySelector('button[type=submit]'),h=d.firstElementChild;return {color:getComputedStyle(b).backgroundColor,token:getComputedStyle(document.documentElement).getPropertyValue('--danger').trim(),height:d.getBoundingClientRect().height,gap:b.getBoundingClientRect().top-h.getBoundingClientRect().bottom};})()");
  assert.equal(deletion.color, "rgb(229, 72, 77)");
  assert.ok(deletion.height < 190 && deletion.gap <= 16, JSON.stringify(deletion));
  await writeFile("/tmp/sirus-delete-dialog.png", Buffer.from((await command("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await evaluate("document.querySelector('[role=dialog] button[type=submit]').focus()"); await settle();
  assert.equal(await evaluate("!!document.querySelector('.sidebar-hover-card')"), false, "Keyboard navigation within confirmation never opens a background card");
  await evaluate("[...document.querySelectorAll('[role=dialog] button')].find(row => row.textContent.includes('Cancelar')).click()"); await delay(200); await settle();
  await command("Input.dispatchMouseEvent", {type:"mouseMoved",x:1450,y:900}); await delay(200);
  await hoverSession();
  await evaluate("[...document.querySelectorAll('[role=menuitem]')].find(row => row.textContent.includes('Renomear')).click()"); await settle(); await delay(150);
  assert.equal(await evaluate("!!document.querySelector('.sidebar-hover-card')"), false, "Rename dialog shares action ownership without stale cards");
  assert.equal(await evaluate("document.querySelector('[role=dialog] button[type=submit]').className.includes('bg-danger')"), false);
  await command("Input.dispatchKeyEvent", {type:"keyDown",key:"Escape",code:"Escape"});
  await command("Input.dispatchKeyEvent", {type:"keyUp",key:"Escape",code:"Escape"}); await delay(200); await settle();
  await command("Input.dispatchMouseEvent", {type:"mouseMoved",x:1450,y:900}); await delay(200);
  const frame = await evaluate("(() => {const f=document.querySelector('.app-content-frame'),r=f.getBoundingClientRect(),app=f.parentElement.getBoundingClientRect();return {right:r.right-app.right,bottom:r.bottom-app.bottom,top:r.top-app.top,radius:getComputedStyle(f).borderRadius};})()");
  assert.equal(frame.right, 0); assert.equal(frame.bottom, 0); assert.equal(frame.radius, "10px");
  await click("[data-action=collapse]"); await aligned();
  const icon = await evaluate("(() => {const r=document.querySelector('[data-section=home]').getBoundingClientRect();return {x:r.x+16,y:r.y+16};})()");
  await command("Input.dispatchMouseEvent", { type:"mouseMoved", ...icon });
  await waitFor("!!document.querySelector('#sidebar-peek')");
  assert.equal(await evaluate("!!document.querySelector('#sidebar-peek [aria-label=\"Fixar barra lateral\"]')"), true);
  await command("Input.dispatchMouseEvent", {type:"mouseMoved",x:1450,y:900}); await delay(250);
  assert.equal(await evaluate("!!document.querySelector('#sidebar-peek')"), false);
  await click("[data-section=settings]");
  assert.equal(await evaluate("!!document.querySelector('.settings-material[role=dialog]')"), true, "Collapsed rail gear must open the original full SettingsPage directly");
  assert.equal(await evaluate("document.querySelector('.settings-material[role=dialog]').textContent.includes('Geral')"), true);
  await command("Input.dispatchKeyEvent", {type:"keyDown", key:"Escape", code:"Escape"});
  await command("Input.dispatchKeyEvent", {type:"keyUp", key:"Escape", code:"Escape"}); await settle();
  assert.equal(await evaluate("!!document.querySelector('.settings-material[role=dialog]')"), false);
  assert.equal(await evaluate("!!document.querySelector('#sidebar-docked')"), false, "Settings does not change main sidebar preferences");
  await click("[data-action=collapse]");
  await click("[data-section=settings]");
  assert.equal(await evaluate("!!document.querySelector('.settings-material[role=dialog] [data-settings-back]')"), true, "Expanded rail gear opens the original grouped settings navigation");
  assert.equal(await evaluate("document.querySelector('.settings-material[role=dialog]').textContent.includes('Pessoal')"), true);
  await click("[data-settings-back]");
  assert.equal(await evaluate("!!document.querySelector('.settings-material[role=dialog]')"), false);
  assert.equal(await evaluate("document.querySelector('.sidebar-panel-header h1').textContent"), "Projeto de exemplo", "Returning from Settings retains the previous sidebar section");
  for (const mode of ["dark", "light", "dark-sidebar", "light-sidebar", "dark-window", "light-window"]) {
    await click(`[data-material=${mode}]`);
    const paint = await evaluate("(() => {const main=document.querySelector('main'),sidebar=document.querySelector('.sidebar-shell'),pane=document.querySelector('[data-chat-container] > section');return {main:getComputedStyle(main).backgroundColor,sidebar:getComputedStyle(sidebar).backgroundColor,image:getComputedStyle(pane).backgroundImage,child:getComputedStyle(pane).backgroundColor,orbits:!!pane.querySelector('.landing-orbits')};})()");
    assert.equal(paint.main, paint.sidebar, `${mode}: conversation uses the sidebar material`);
    assert.equal(paint.image, "none"); assert.equal(paint.child, "rgba(0, 0, 0, 0)"); assert.equal(paint.orbits, false);
    await aligned();
  }
  for (const mode of ["new", "handoff"]) {
    await click(`[data-mode=${mode}]`);
    assert.equal(await evaluate("!!document.querySelector('main.main-material .dot-grid .landing-orbits')"), true, `${mode}: existing landing material and orbits preserved`);
    if (mode === "handoff") assert.equal(await evaluate("document.querySelector('.agent-composer').textContent.includes('Continuar o trabalho')"), true);
    await aligned();
  }
  await click("[data-mode=conversation]"); await click("[data-material=dark]");
  await writeFile("/tmp/sirus-layout-fixture.png", Buffer.from((await command("Page.captureScreenshot", { format: "png" })).data, "base64"));
  assert.deepEqual(errors, [], "No runtime or CSP errors in the isolated preview");
  console.log("Headless fixture regression: nonce-only CSP, real CodeMirror gutter layout/edit/shortcut, file review split/unified, Markdown, glass popup, completion summary, mock Undo/Keep/Revert, actual SessionPane send/stream/resize/history/bookmark scrolling and Sidebar frame/hover/title-only rows, compact icons, composer-aligned usage, six conversation materials and unchanged landing/handoff, compact red deletion and menu/modal hover ownership passed");
} finally {
  socket?.close(); chrome.kill();
  await new Promise(resolve => http.close(resolve));
  await delay(200);
  await rm(profile, { recursive: true, force: true });
}
