import type { RemoteDevice } from "@/client/types";

/** Time left on a pairing code as "m:ss"; `null` once it has expired. */
export function pairingCountdown(expiresAt: string, now: number): string | null {
  const left = Math.ceil((Date.parse(expiresAt) - now) / 1000);
  if (!Number.isFinite(left) || left <= 0) return null;
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

/** The device that joined since `before` was read, if any. */
export function newlyPaired(before: readonly RemoteDevice[], after: readonly RemoteDevice[]): RemoteDevice | null {
  const known = new Set(before.map((device) => device.id));
  return after.find((device) => !known.has(device.id)) ?? null;
}

/** The QR markup as an image source, so it is never injected as HTML. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
