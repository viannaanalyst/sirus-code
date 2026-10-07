import { test } from "node:test";
import assert from "node:assert/strict";
import { base64UrlBytes, pushSupportFor, type PushEnvironment } from "../src/client/remote-push.ts";

const ready: PushEnvironment = { secure: true, serviceWorker: true, pushManager: true, notification: true, permission: "default", ios: true, standalone: true };

test("Alerts explain what is missing before offering the switch", () => {
  assert.equal(pushSupportFor(ready), "ready");
  assert.equal(pushSupportFor({ ...ready, secure: false }), "insecure", "plain HTTP comes first");
  assert.equal(pushSupportFor({ ...ready, standalone: false, pushManager: false }), "install", "iPhone Safari needs the home-screen app");
  assert.equal(pushSupportFor({ ...ready, ios: false, pushManager: false }), "unsupported");
  assert.equal(pushSupportFor({ ...ready, permission: "denied" }), "denied");
  assert.equal(pushSupportFor({ ...ready, ios: false, standalone: false }), "ready", "desktop browsers need no install");
});

test("The Mac's key becomes the bytes a browser subscribes with", () => {
  assert.deepEqual([...base64UrlBytes("AQID_-8")], [1, 2, 3, 255, 239]);
  assert.equal(base64UrlBytes("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4").length, 65);
});
