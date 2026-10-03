import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { NotificationSettings } = await server.ssrLoadModule("/src/components/settings/NotificationSettings.tsx");
  const { ActivityNotifications } = await server.ssrLoadModule("/src/components/ActivityNotifications.tsx");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const { mergeSettings } = await server.ssrLoadModule("/src/lib/settings.ts");
  const { translate } = await server.ssrLoadModule("/src/i18n/index.ts");
  const snapshot = useAppStore.getInitialState();
  for (const locale of ["pt-BR", "en"]) {
    const settings = mergeSettings({ locale });
    Object.assign(snapshot, { settings }); useAppStore.setState({ settings });
    const html = renderToString(createElement(NotificationSettings, { settings, onSave: () => {} }));
    for (const label of ["Notifications", "Permission requests", "Questions from the agent", "Task completed", "Events and sounds"]) {
      assert.ok(html.includes(translate(locale, label)), label);
    }
    assert.equal([...html.matchAll(/role="switch"/g)].length, 7, "master controls and each event are independent");
    assert.equal([...html.matchAll(/role="combobox"/g)].length, 3, "three existing Arc sound selectors");
    assert.equal([...html.matchAll(/aria-label="[^"<>]*Preview sound|aria-label="[^"<>]*Ouvir som/g)].length, 3);
    assert.equal([...html.matchAll(new RegExp(translate(locale, "Restore defaults"), "g"))].length, 1, "one page reset only");
    assert.doesNotMatch(html, /role="tooltip"/);
    const session = { id: "owned" };
    const notice = { id: "notice", sessionId: "owned", kind: "question", title: "Answer needed", body: "Project · Session", createdAt: Date.now() };
    Object.assign(snapshot, { sessions: [session], activityNotifications: [notice] });
    useAppStore.setState({ sessions: [session], activityNotifications: [notice] });
    const activity = renderToString(createElement(ActivityNotifications));
    assert.ok(activity.includes(translate(locale, "Open session")));
    assert.ok(activity.includes('data-variant="info"'), "requests are not success messages");
    Object.assign(snapshot, { activityNotifications: [{ ...notice, createdAt: 0 }] });
    useAppStore.setState({ activityNotifications: [{ ...notice, createdAt: 0 }] });
    assert.ok(!renderToString(createElement(ActivityNotifications)).includes("Answer needed"), "expired notices never replay on remount");
  }
  console.log("Notification settings: localized switches, Arc selectors, previews, one reset, request toast and expiry renders passed");
} finally { await server.close(); }
