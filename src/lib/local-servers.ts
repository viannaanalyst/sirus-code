// Bounded detection of local development servers from terminal/agent output.
const LOCAL_SERVER_PATTERN =
  /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?(?:[/?#][^\s"'`<>)\]},;]*)?/g;

export function scanLocalServers(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(LOCAL_SERVER_PATTERN)) {
    const candidate = match[0].replace(/[.,;:!?]+$/, "");
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
