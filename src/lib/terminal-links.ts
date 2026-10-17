/**
 * Whether a terminal hyperlink (an OSC 8 target or a detected address) may be
 * opened: only absolute http(s) URLs with a host, never javascript:, file: or data:.
 */
export function terminalLinkTarget(uri: string): string | null {
  const text = uri.trim();
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname ? text : null;
  } catch {
    return null;
  }
}
