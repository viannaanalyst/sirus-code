// Sirus Code service worker (ADR-082, ADR-084): shows alerts the Mac pushes and
// opens their conversation when tapped. It also keeps the app shell, so the
// home-screen app opens (and says it is reconnecting) when the Mac is out of reach
// instead of showing a blank page. The Mac stays the source: pages are fetched
// from it first; API calls are never cached.
const SHELL = "sirus-shell-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key !== SHELL) await caches.delete(key);
  await self.clients.claim();
})()));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(SHELL)).put("/", response.clone());
        return response;
      } catch {
        return (await caches.match("/")) ?? Response.error();
      }
    })());
    return;
  }
  // Built files carry a content hash in their name, so a stored copy never goes stale.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/pwa/") || /\.(png|svg|woff2?)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) (await caches.open(SHELL)).put(request, response.clone());
      return response;
    })());
  }
});

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
