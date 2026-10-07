import assert from "node:assert/strict";
import { test } from "node:test";
import { maskInput, maskSecrets, maskValue, sensitiveName } from "../src/lib/redact";
import { isSecretRow, stepDetail, stepSentence } from "../src/lib/turn-timeline";

test("known token shapes keep their prefix and last four characters", () => {
  assert.equal(maskSecrets("key sk-proj-abcdefghijklmnop1234 ok"), "key sk-proj-••••1234 ok");
  assert.equal(maskSecrets("ghp_0123456789abcdefghijABCD"), "ghp_••••ABCD");
  assert.equal(maskSecrets("xoxb-1234567890-abcdefgh"), "xoxb-••••efgh");
  assert.equal(maskSecrets("AKIAABCDEFGHIJKLMNOP"), "AKIA••••MNOP");
  assert.equal(maskSecrets("sk-ant-api03-aaaaaaaaaaaaaaaa9999"), "sk-ant-api03-••••9999");
  assert.equal(maskSecrets("task-runner and desk-lamp"), "task-runner and desk-lamp");
});

test("flags, headers, assignments and URL passwords lose their values", () => {
  assert.equal(maskSecrets("mysql --password hunter2 -u root"), "mysql --password •••• -u root");
  assert.equal(maskSecrets("login --token=abc123"), "login --token=••••");
  assert.equal(maskSecrets("run --verbose --token abc123"), "run --verbose --token ••••");
  assert.equal(maskSecrets("curl -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'"), "curl -H 'Authorization: Bearer ••••.sig'");
  assert.equal(maskSecrets("GITHUB_TOKEN=abc123 npm publish"), "GITHUB_TOKEN=•••• npm publish");
  assert.equal(maskSecrets("export DB_PASSWORD=\"correct horse\""), "export DB_PASSWORD=\"••••\"");
  assert.equal(maskSecrets("{\"apiKey\": \"abcdefghijklmnop\"}"), "{\"apiKey\": \"••••mnop\"}");
  assert.equal(maskSecrets("git clone https://user:s3cretpass@github.com/x/y"), "git clone https://user:••••@github.com/x/y");
  assert.equal(maskSecrets("SESSION_SALT=Zx8kP2qLm9Rt4Vw7Yb3Nc6Hd1Jf5Gs0A"), "SESSION_SALT=••••Gs0A");
});

test("counters, references and ordinary text are kept", () => {
  for (const text of ["max_tokens=4096", "prompt_tokens: 120", "TOKEN=$GITHUB_TOKEN", "password: ${{ secrets.DB }}", "NODE_ENV=production", "PATH=/usr/local/bin:/usr/bin", "BUILD_ID=2026-10-07", "see https://example.com/docs", "npm test -- --watch", ""]) {
    assert.equal(maskSecrets(text), text, text);
  }
});

test("names are classified by their last word and tool input is masked by key", () => {
  for (const name of ["GITHUB_TOKEN", "apiKey", "db-password", "client_secret", "AWS_SECRET_ACCESS_KEY", "Authorization", "token", "x-api-key"]) assert.ok(sensitiveName(name), name);
  for (const name of ["max_tokens", "tokenizer", "keyboard", "primary_key", "monkey", "passenger", "user"]) assert.ok(!sensitiveName(name), name);
  assert.equal(maskValue("short"), "••••");
  assert.equal(maskValue("abcdefghijklmnop"), "••••mnop");
  assert.deepEqual(maskInput({ url: "https://api.example.com", headers: { Authorization: "Bearer abcdefghijklmnop" }, password: "pw", count: 3 }), { url: "https://api.example.com", headers: { Authorization: "••••mnop" }, password: "••••", count: 3 });
});

test("the app's secret row names only its label", () => {
  const t = (key: string, params?: Record<string, string | number>) => `${key}:${params?.label ?? params?.detail ?? ""}`;
  const row = { id: "secret:r1", kind: "tool" as const, label: "Secret provided", state: "completed" as const, model: null, detail: "Stripe key" };
  assert.ok(isSecretRow(row));
  assert.equal(stepSentence(row, t), "timeline.secretProvided:Stripe key");
  assert.ok(!isSecretRow({ ...row, id: "call_1" }));
  assert.equal(stepDetail("Authorization: Bearer abcdefghijklmnopqrst"), "Authorization: Bearer ••••qrst");
});
