// Runs in an isolated WebKit content world (the page cannot see or call it) in the main
// frame of every browser tab (ADR-186). When the person submits a form that holds a typed
// password, it reports { u: username, p: password } to the app, which decides whether to
// offer saving it. It only reports trusted events (the person's own, never a script's click
// or an agent's synthetic keys), and the app takes the site from the webview, not from here.
(function (win, doc, post) {
  const type = (el) => String((el && el.type) || "text").toLowerCase();
  const visible = (el) => {
    if (el.disabled || el.hidden) return false;
    if (typeof el.getBoundingClientRect !== "function") return true;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const inputs = (scope) => Array.from(scope.querySelectorAll("input"));

  // The typed password and the username field before it, or null when this is not a sign-in.
  const extract = (scope) => {
    const all = inputs(scope);
    const passwords = all.filter((el) => type(el) === "password" && visible(el) && el.value);
    if (passwords.length === 0 || passwords.length > 2) return null;
    // Two different passwords is a change-password form: not a sign-in to save.
    if (passwords.length === 2 && passwords[0].value !== passwords[1].value) return null;
    const password = passwords[0];
    const before = all.slice(0, all.indexOf(password));
    const names = before.filter((el) => ["text", "email", "tel", "search"].includes(type(el)) && visible(el) && el.value);
    const named = names.filter((el) => /user|email|login|name/i.test(el.autocomplete + " " + el.name + " " + el.id));
    const field = (named.length ? named : names).slice(-1)[0];
    return { u: field ? String(field.value).trim() : "", p: String(password.value) };
  };

  let last = { key: "", at: 0 };
  const report = (scope, event) => {
    if (!event.isTrusted) return;
    const found = extract(scope);
    if (!found) return;
    const key = found.u + "\u0000" + found.p;
    const now = Date.now();
    if (key === last.key && now - last.at < 2000) return;
    last = { key, at: now };
    try { post(JSON.stringify(found)); } catch (_) {}
  };

  const scopeOf = (el) => (el && el.tagName === "FORM" ? el : (el && el.form) || doc);
  const submitLike = (el) => {
    for (let node = el; node; node = node.parentElement) {
      const tag = node.tagName;
      if (tag === "INPUT" && type(node) === "submit") return true;
      if (tag === "BUTTON") {
        const kind = type(node);
        const label = (node.textContent || "") + " " + ((node.getAttribute && node.getAttribute("aria-label")) || "") + " " + (node.title || "");
        // The eye that shows or hides the password is not a submission.
        if (/show|hide|reveal|toggle|mostrar|ocultar|exibir/i.test(label)) return false;
        return kind === "submit" || (kind !== "button" && kind !== "reset") || /sign ?in|log ?in|entrar|continue|next|submit|acessar/i.test(node.textContent || "");
      }
    }
    return false;
  };

  doc.addEventListener("submit", (event) => report(scopeOf(event.target), event), true);
  doc.addEventListener("click", (event) => { if (submitLike(event.target)) report(scopeOf(event.target), event); }, true);
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target && event.target.tagName === "INPUT") report(scopeOf(event.target), event);
  }, true);
})
