// Loopback preview addresses a project script may open (ADR-151). Mirrors the native check in
// `local_servers::loopback_url`; the native side is the authority, this keeps the editor honest.

export const PREVIEW_URL_MAX_LENGTH = 512;

/** True for a blank value (no preview) or an http(s) URL on localhost, 127.0.0.1 or [::1] with a port. */
export function isPreviewUrlValid(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length > PREVIEW_URL_MAX_LENGTH || /\s/.test(trimmed) || [...trimmed].some((char) => char.charCodeAt(0) < 32)) return false;
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { return false; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) return false;
  return parsed.port !== "" && Number(parsed.port) > 0;
}
