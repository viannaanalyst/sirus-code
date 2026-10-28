// Fills a saved login into the page (ADR-186). `args` is JSON from the app: { origin,
// part: "login" | "totp", username, password, code }. The values are function arguments,
// never spliced into source, and the result lists field names only, never a value.
const input = JSON.parse(args);
const fail = (error) => JSON.stringify({ ok: false, error });
if (location.origin !== input.origin) return fail("the page is on a different site than the saved login");
const type = (el) => String(el.type || "text").toLowerCase();
const visible = (el) => {
  if (el.disabled || el.readOnly || el.hidden) return false;
  if (typeof el.getBoundingClientRect !== "function") return true;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};
const label = (el) => [el.autocomplete, el.name, el.id, el.placeholder, el.getAttribute && el.getAttribute("aria-label")].filter(Boolean).join(" ");
const set = (el, value) => {
  if (el.focus) el.focus();
  const proto = typeof HTMLInputElement !== "undefined" ? HTMLInputElement.prototype : null;
  const descriptor = proto && Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor && descriptor.set) descriptor.set.call(el, value); else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
const all = Array.from(document.querySelectorAll("input"));
const fields = [];

if (input.part === "totp") {
  const code = String(input.code || "");
  const pattern = /otp|totp|2fa|mfa|one.?time|verif|security.?code|authenticator|token|code/i;
  const found = all.filter((el) => visible(el) && ["text", "number", "tel", "password"].includes(type(el)) && (el.autocomplete === "one-time-code" || pattern.test(label(el))));
  if (!found.length) return fail("no verification code field found on this page");
  if (found.length >= code.length && found.slice(0, code.length).every((el) => el.maxLength === 1)) {
    for (let i = 0; i < code.length; i++) set(found[i], code[i]);
  } else {
    set(found[0], code);
  }
  fields.push("code");
  return JSON.stringify({ ok: true, fields });
}

const passwords = all.filter((el) => type(el) === "password" && visible(el));
if (passwords.length > 2) return fail("this looks like a change-password form, not a sign-in");
const names = all.filter((el) => ["text", "email", "tel"].includes(type(el)) && visible(el) && el.autocomplete !== "one-time-code");
const usernameLike = /user|email|login|account|identifier|phone|e-?mail/i;
let userField = null;
if (passwords.length) {
  const before = names.filter((el) => all.indexOf(el) < all.indexOf(passwords[0]));
  const likely = before.filter((el) => type(el) === "email" || usernameLike.test(label(el)));
  userField = (likely.length ? likely : before).slice(-1)[0] || null;
} else {
  userField = names.find((el) => type(el) === "email" || usernameLike.test(label(el))) || null;
}
if (!userField && !passwords.length) return fail("no sign-in fields found on this page");
if (userField) { set(userField, String(input.username)); fields.push("username"); }
if (passwords.length) { for (const field of passwords) set(field, String(input.password)); fields.push("password"); }
return JSON.stringify({ ok: true, fields });
