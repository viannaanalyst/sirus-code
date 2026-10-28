import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The page scripts of the browser login vault (ADR-186), run against a tiny fake DOM.
const read = (name: string) => readFileSync(new URL(`../src-tauri/src/${name}`, import.meta.url), "utf8");
const captureSource = read("browser_login_capture.js");
const fillSource = read("browser_login_fill.js");

interface FakeInput {
  tagName: string; type: string; value: string; name: string; id: string; autocomplete: string; placeholder: string;
  disabled: boolean; hidden: boolean; readOnly: boolean; maxLength: number; form?: unknown; parentElement?: unknown;
  events: string[]; focus(): void; dispatchEvent(event: { type: string }): boolean; getAttribute(name: string): string | null;
}

function input(type: string, value = "", extra: Partial<FakeInput> = {}): FakeInput {
  const events: string[] = [];
  return {
    tagName: "INPUT", type, value, name: "", id: "", autocomplete: "", placeholder: "", disabled: false, hidden: false, readOnly: false, maxLength: -1,
    events, focus() {}, dispatchEvent(event) { events.push(event.type); return true; }, getAttribute: () => null, ...extra,
  };
}

function page(inputs: FakeInput[]) {
  const handlers: Record<string, Array<(event: unknown) => void>> = {};
  const form = { tagName: "FORM", querySelectorAll: () => inputs };
  inputs.forEach((item) => { item.form = form; });
  const doc = {
    addEventListener: (type: string, handler: (event: unknown) => void) => { (handlers[type] ??= []).push(handler); },
    querySelectorAll: () => inputs,
  };
  const posted: Array<{ u: string; p: string }> = [];
  (new Function(`return (${captureSource}\n)`)() as (...args: unknown[]) => void)({}, doc, (message: string) => posted.push(JSON.parse(message)));
  const fire = (type: string, event: Record<string, unknown>) => handlers[type]?.forEach((handler) => handler({ isTrusted: true, ...event }));
  return { posted, fire, form, doc };
}

test("a submitted password form is reported with its username", () => {
  const user = input("email", "ana@example.com", { name: "email" });
  const password = input("password", "s3cret-pw");
  const { posted, fire, form } = page([user, password]);
  fire("submit", { target: form });
  assert.deepEqual(posted, [{ u: "ana@example.com", p: "s3cret-pw" }]);
});

test("only the person's own events count, and an empty password is not a sign-in", () => {
  const empty = page([input("text", "ana"), input("password", "")]);
  empty.fire("submit", { target: empty.form });
  assert.equal(empty.posted.length, 0);

  const scripted = page([input("text", "ana"), input("password", "pw")]);
  scripted.fire("submit", { target: scripted.form, isTrusted: false });
  assert.equal(scripted.posted.length, 0);
});

test("change-password forms, hidden fields and honeypots are ignored", () => {
  const change = page([input("password", "old"), input("password", "new")]);
  change.fire("submit", { target: change.form });
  assert.equal(change.posted.length, 0);

  const hidden = page([input("text", "bot", { hidden: true, name: "username" }), input("text", "ana", { name: "user" }), input("password", "pw")]);
  hidden.fire("submit", { target: hidden.form });
  assert.equal(hidden.posted[0]?.u, "ana");

  const confirm = page([input("text", "ana"), input("password", "same"), input("password", "same")]);
  confirm.fire("submit", { target: confirm.form });
  assert.equal(confirm.posted[0]?.p, "same");
});

test("Enter in a field and a sign-in button report; the eye button and repeats do not", () => {
  const user = input("text", "ana");
  const password = input("password", "pw-1234");
  const { posted, fire } = page([user, password]);
  const eye = { tagName: "BUTTON", type: "submit", textContent: "Show password", getAttribute: () => null, title: "" };
  fire("click", { target: eye });
  assert.equal(posted.length, 0);
  const plainButton = { tagName: "BUTTON", type: "button", textContent: "More", getAttribute: () => null, title: "" };
  fire("click", { target: plainButton });
  assert.equal(posted.length, 0);

  const signIn = { tagName: "BUTTON", type: "submit", textContent: "Sign in", getAttribute: () => null, title: "", form: undefined };
  fire("click", { target: signIn });
  assert.equal(posted.length, 1);
  // The same values again within a moment (click, then submit) are one report.
  fire("keydown", { key: "Enter", target: password });
  assert.equal(posted.length, 1);
});

// ---- Fill ----

function fill(inputs: FakeInput[], args: Record<string, unknown>, origin = "https://example.com") {
  const run = new Function("args", "location", "document", fillSource) as (...values: unknown[]) => string;
  return JSON.parse(run(JSON.stringify(args), { origin }, { querySelectorAll: () => inputs })) as { ok: boolean; error?: string; fields?: string[] };
}

const credentials = { origin: "https://example.com", part: "login", username: "ana@example.com", password: "hunter2-correct" };

test("filling puts values in the page and reports field names only", () => {
  const user = input("email", "", { name: "email" });
  const password = input("password");
  const result = fill([input("search"), user, password], credentials);
  assert.deepEqual(result, { ok: true, fields: ["username", "password"] });
  assert.equal(user.value, "ana@example.com");
  assert.equal(password.value, "hunter2-correct");
  assert.ok(password.events.includes("input") && password.events.includes("change"));
  assert.ok(!JSON.stringify(result).includes("hunter2"));
});

test("filling refuses another origin, change-password forms and pages without fields", () => {
  const password = input("password");
  const wrongSite = fill([input("text"), password], credentials, "https://login.example.com");
  assert.equal(wrongSite.ok, false);
  assert.equal(password.value, "");
  assert.equal(fill([input("password"), input("password"), input("password")], credentials).ok, false);
  assert.equal(fill([input("search", "", { name: "q" })], credentials).ok, false);
  // A first step with only an email field fills the username and no password.
  const step = input("email", "", { name: "identifier" });
  assert.deepEqual(fill([step], credentials), { ok: true, fields: ["username"] });
  assert.equal(step.value, "ana@example.com");
});

test("an authenticator code goes into one field or one digit per box", () => {
  const single = input("text", "", { autocomplete: "one-time-code" });
  assert.deepEqual(fill([single], { origin: "https://example.com", part: "totp", code: "123456" }), { ok: true, fields: ["code"] });
  assert.equal(single.value, "123456");
  const boxes = Array.from({ length: 6 }, (_, index) => input("text", "", { name: `otp-${index}`, maxLength: 1 }));
  fill(boxes, { origin: "https://example.com", part: "totp", code: "654321" });
  assert.equal(boxes.map((box) => box.value).join(""), "654321");
  assert.equal(fill([input("text", "", { name: "q" })], { origin: "https://example.com", part: "totp", code: "123456" }).ok, false);
});
