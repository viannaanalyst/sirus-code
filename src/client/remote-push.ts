/**
 * Alerts on a paired device (ADR-082): a service worker and a web-push
 * subscription the Mac posts to. iPhone allows this only for a home-screen app
 * opened over HTTPS.
 */
export type PushSupport = "insecure" | "install" | "unsupported" | "denied" | "ready";

export interface PushEnvironment {
  secure: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  permission: NotificationPermission | null;
  ios: boolean;
  standalone: boolean;
}

export function pushSupportFor(env: PushEnvironment): PushSupport {
  if (!env.secure) return "insecure";
  // iPhone exposes push only inside a home-screen app.
  if (env.ios && !env.standalone) return "install";
  if (!env.serviceWorker || !env.pushManager || !env.notification) return "unsupported";
  if (env.permission === "denied") return "denied";
  return "ready";
}

export function pushSupport(): PushSupport {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return pushSupportFor({
    secure: window.isSecureContext,
    serviceWorker: "serviceWorker" in navigator,
    pushManager: "PushManager" in window,
    notification: "Notification" in window,
    permission: "Notification" in window ? Notification.permission : null,
    ios: /iPhone|iPad|iPod/.test(navigator.userAgent),
    standalone: window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true,
  });
}

/** `applicationServerKey` arrives base64url; the browser wants bytes. */
export function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Registers the worker on a secure page; quiet elsewhere. */
export async function registerPushWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!window.isSecureContext || !("serviceWorker" in navigator)) return null;
  try { return await navigator.serviceWorker.register("/sw.js", { scope: "/" }); } catch { return null; }
}

export async function pushEnabled(): Promise<boolean> {
  if (!window.isSecureContext || !("serviceWorker" in navigator)) return false;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return Boolean(await registration?.pushManager.getSubscription());
}

const authorized = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Asks for permission, subscribes and tells the Mac; returns false when the person declines. */
export async function enablePush(token: string, request: typeof fetch = fetch): Promise<boolean> {
  if (await Notification.requestPermission() !== "granted") return false;
  const registration = await registerPushWorker() ?? await navigator.serviceWorker.ready;
  const keyResponse = await request("/api/push", { headers: authorized(token) });
  if (!keyResponse.ok) throw new Error("The Mac did not share its alert key.");
  const { publicKey } = await keyResponse.json() as { publicKey: string };
  const subscription = await registration.pushManager.getSubscription()
    ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlBytes(publicKey) });
  const saved = await request("/api/push", { method: "PUT", headers: { ...authorized(token), "Content-Type": "application/json" }, body: JSON.stringify(subscription.toJSON()) });
  if (!saved.ok) throw new Error("The Mac could not save this device's alerts.");
  return true;
}

export async function disablePush(token: string, request: typeof fetch = fetch): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  await (await registration?.pushManager.getSubscription())?.unsubscribe();
  await request("/api/push", { method: "DELETE", headers: authorized(token) });
}
