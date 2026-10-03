export function editorKey(sessionId: string, path: string): string {
  return `${sessionId}:${path}`;
}

/** The acknowledged disk value must not replace text typed while Save was pending. */
export function acknowledgeEditorSave<T extends { content: string; saved: string }>(buffer: T, saved: string): T {
  return { ...buffer, saved };
}
