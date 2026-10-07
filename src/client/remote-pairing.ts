/**
 * Pairing for the UI served to another device (ADR-080): the QR code on the Mac
 * opens `http://<mac>:<port>/?pair=<code>`; the code is exchanged once for this
 * device's own token, kept in local storage.
 */
export const REMOTE_TOKEN_KEY = "sirus.remote.token";

export function pairingCode(search: string): string | null {
  const code = new URLSearchParams(search).get("pair")?.trim();
  return code && /^[A-Za-z0-9_-]{8,128}$/.test(code) ? code : null;
}

/** A readable name for the device list on the Mac: "iPhone · Safari". */
export function deviceName(userAgent: string): string {
  const device = /iPad/.test(userAgent) ? "iPad"
    : /iPhone/.test(userAgent) ? "iPhone"
    : /Android/.test(userAgent) ? "Android"
    : /Macintosh/.test(userAgent) ? "Mac"
    : /Windows/.test(userAgent) ? "Windows"
    : /Linux/.test(userAgent) ? "Linux"
    : "Device";
  const browser = /EdgA?\//.test(userAgent) ? "Edge"
    : /CriOS|Chrome\//.test(userAgent) ? "Chrome"
    : /FxiOS|Firefox\//.test(userAgent) ? "Firefox"
    : /Safari\//.test(userAgent) ? "Safari"
    : "";
  return browser ? `${device} · ${browser}` : device;
}

/** Exchanges a pairing code for a device token; throws with the Mac's message when refused. */
export async function redeemPairing(code: string, name: string, request: typeof fetch = fetch): Promise<string> {
  const response = await request("/api/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name }),
  });
  const body = await response.json().catch(() => ({})) as { token?: unknown; message?: unknown };
  if (!response.ok || typeof body.token !== "string") {
    throw new Error(typeof body.message === "string" ? body.message : "The Mac refused this pairing code.");
  }
  return body.token;
}

/** The address of the Mac's socket for a page it served. */
export function socketUrl(location: Pick<Location, "protocol" | "host">): string {
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/socket`;
}
