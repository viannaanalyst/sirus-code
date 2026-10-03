import test from "node:test";
import assert from "node:assert/strict";
import { mergeSettings } from "../src/lib/settings.ts";
import { normalizeNotifications, resetNotificationSettings, retainActivityNotifications, NOTIFICATION_SOUNDS } from "../src/lib/notifications.ts";

test("legacy preferences migrate and sound ids cannot become filenames", () => {
  const settings = mergeSettings({});
  assert.deepEqual(settings.notifications, normalizeNotifications());
  assert.equal(normalizeNotifications({ completionSound: "../../secret" } as never).completionSound, "glass");
  assert.equal(NOTIFICATION_SOUNDS.length, 6);
});

test("events and sounds persist independently; page reset preserves other settings", () => {
  const settings = mergeSettings({ defaultAgent: "claude", theme: "light", notifications: {
    ...normalizeNotifications(), permissions: false, questions: true, completionSound: "hero", questionSound: "tink", foreground: true,
  } });
  const restored = mergeSettings(JSON.parse(JSON.stringify(settings)));
  assert.equal(restored.notifications.permissions, false);
  assert.equal(restored.notifications.questions, true);
  assert.equal(restored.notifications.completionSound, "hero");
  assert.equal(restored.notifications.questionSound, "tink");
  const reset = resetNotificationSettings(restored);
  assert.deepEqual(reset.notifications, normalizeNotifications());
  assert.equal(reset.defaultAgent, "claude");
  assert.equal(reset.theme, "light");
});

test("activity expires from arrival and disabled preferences discard queued notices", () => {
  const notice = { id: "notice", sessionId: "session", kind: "completion" as const, title: "Done", body: "Work", createdAt: 1000 };
  assert.equal(retainActivityNotifications([notice], normalizeNotifications(), 5000).length, 1);
  assert.equal(retainActivityNotifications([notice], normalizeNotifications(), 7500).length, 0);
  assert.equal(retainActivityNotifications([notice], normalizeNotifications({ toasts: false }), 2000).length, 0);
  assert.equal(retainActivityNotifications([notice], normalizeNotifications({ completion: false }), 2000).length, 0);
  assert.equal(retainActivityNotifications([{ ...notice, createdAt: NaN }], normalizeNotifications(), 2000).length, 0);
});
