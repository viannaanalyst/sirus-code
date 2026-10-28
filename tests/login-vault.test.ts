import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyLoginDraft, loginInput, siteLabel } from "../src/lib/login-vault.ts";
import { translate } from "../src/i18n/index.ts";

test("the settings form becomes a save request without ever reading a saved password", () => {
  const draft = { ...emptyLoginDraft, site: " example.com ", username: " ana ", password: "pw", totp: "", agentUse: true };
  assert.deepEqual(loginInput(draft), { id: null, origin: "example.com", username: "ana", password: "pw", totp: null, agentUse: true });
  // A new login needs a password; an edit keeps the saved one when the field is empty.
  assert.equal(loginInput({ ...draft, password: "" }), null);
  assert.deepEqual(loginInput({ ...draft, id: "abc", password: "" }), { id: "abc", origin: "example.com", username: "ana", password: null, totp: null, agentUse: true });
  assert.equal(loginInput({ ...draft, site: "" }), null);
  assert.equal(loginInput({ ...draft, username: "  " }), null);
  // The authenticator secret: empty keeps it, a lone dash clears it.
  assert.equal(loginInput({ ...draft, id: "abc", totp: "-" })?.totp, "");
  assert.equal(loginInput({ ...draft, totp: " JBSWY3DPEHPK3PXP " })?.totp, "JBSWY3DPEHPK3PXP");
});

test("a site is shown by host, with the port when it has one", () => {
  assert.equal(siteLabel("https://example.com"), "example.com");
  assert.equal(siteLabel("http://localhost:3000"), "localhost:3000");
  assert.equal(siteLabel("not a url"), "not a url");
});

test("the vault strings exist in English and Portuguese", () => {
  for (const key of ["vault.title", "offer.title", "approval.title", "autofill.title"]) {
    assert.notEqual(translate("en", key), key);
    assert.notEqual(translate("pt-BR", key), key);
  }
  assert.match(translate("en", "offer.title", { site: "example.com" }), /Save login for example\.com\?/);
});
