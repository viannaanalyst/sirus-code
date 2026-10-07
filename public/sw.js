// Sirus Code service worker (ADR-082): shows alerts the Mac pushes and opens
// their conversation when tapped. No caching; the Mac serves every request.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const sessionId = typeof data.sessionId === "string" ? data.sessionId : "";
  event.waitUntil(self.registration.showNotification(typeof data.title === "string" && data.title ? data.title : "Sirus Code", {
    body: typeof data.body === "string" ? data.body : "",
    tag: sessionId || undefined,
    data: { sessionId },
    icon: "/pwa/icon-192.png",
    badge: "/pwa/icon-192.png",
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const sessionId = event.notification.data && event.notification.data.sessionId;
  const url = sessionId ? `/?session=${encodeURIComponent(sessionId)}` : "/";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        if (sessionId) client.postMessage({ type: "open-session", sessionId });
        return client.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
