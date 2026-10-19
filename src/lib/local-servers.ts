// Local development servers (ADR-151): native listeners merged with URLs read from terminal/agent output.
// Servers that bind every interface print `0.0.0.0` or `[::]`; those are shown as localhost.
const LOCAL_SERVER_PATTERN =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?![\w.-])(?::\d{1,5})?(?:[/?#][^\s"'`<>)\]},;]*)?/g;
const ANY_HOST = /^(https?:\/\/)(?:0\.0\.0\.0|\[::1?\])/;
const MAX_SERVERS = 8;

/** A listener the app found natively (`local_servers_list`). */
export interface NativeLocalServer { url: string; port: number; pid: number; process: string; owned: boolean; inWorkspace: boolean }

/** One row in the browser's empty state and the Environment card. `null` fields come from output scanning only. */
export interface LocalServerEntry { url: string; port: number | null; process: string | null; owned: boolean | null }

export function scanLocalServers(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(LOCAL_SERVER_PATTERN)) {
    const candidate = match[0].replace(/[.,;:!?]+$/, "").replace(ANY_HOST, "$1localhost");
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") continue;
      if (parsed.port && (Number(parsed.port) < 1 || Number(parsed.port) > 65535)) continue;
      found.push(parsed.pathname === "/" ? parsed.origin : `${parsed.origin}${parsed.pathname}`);
    } catch {
      // Malformed candidates are ignored; output is untrusted.
    }
  }
  return [...new Set(found)].slice(0, 4);
}

/** The port a scanned URL names: its explicit port, or the scheme's default. */
export function urlPort(url: string): number | null {
  try {
    const parsed = new URL(url);
    if (parsed.port) return Number(parsed.port);
    return parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return null;
  }
}

/**
 * Native listeners first (they carry the process name and ownership), then scanned URLs whose port
 * the native list does not already show. One row per port, at most eight.
 */
export function mergeLocalServers(native: NativeLocalServer[], scanned: string[]): LocalServerEntry[] {
  const entries: LocalServerEntry[] = native.map((server) => ({ url: server.url, port: server.port, process: server.process, owned: server.owned }));
  const ports = new Set(entries.map((entry) => entry.port));
  for (const url of scanned) {
    const port = urlPort(url);
    if (port !== null && ports.has(port)) continue;
    if (port !== null) ports.add(port);
    entries.push({ url, port, process: null, owned: null });
  }
  return entries.slice(0, MAX_SERVERS);
}
