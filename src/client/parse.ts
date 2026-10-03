function asText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) {
    return value.map((item) => asText(item)).filter(Boolean).join("\n") || null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["text", "message", "delta", "output", "content"]) {
      const found = asText(record[key]);
      if (found) return found;
    }
  }
  return null;
}

export function visibleAgentText(chunk: string): string {
  const lines = chunk.split("\n");
  const visible: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        const text = asText(parsed);
        if (text) visible.push(text);
      } catch {
        visible.push(line);
      }
    } else {
      visible.push(line);
    }
  }
  return visible.join("\n");
}
