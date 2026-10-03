// Match the existing native draft byte limit. Quotes remain editable plain text.
const DRAFT_BYTES = 64 * 1024;

export function appendTranscriptQuote(draft: string, text: string): string | null {
  const passage = text.replace(/\r\n?/g, "\n").trim();
  if (!passage || passage.length > DRAFT_BYTES || draft.length > DRAFT_BYTES) return null;
  const separator = !draft || draft.endsWith("\n\n") ? "" : draft.endsWith("\n") ? "\n" : "\n\n";
  const next = `${draft}${separator}${passage.split("\n").map(line => `> ${line}`).join("\n")}\n\n`;
  return new TextEncoder().encode(next).length <= DRAFT_BYTES ? next : null;
}

export interface TranscriptSelection { messageId: string; text: string; rect: DOMRect; }

/** Only one message's visible body may supply a quote, never surrounding actions. */
export function readTranscriptSelection(root: HTMLElement, selection: Selection | null): TranscriptSelection | null {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const body = (node: Node | null) => {
    const element = node?.nodeType === 1 ? node as Element : node?.parentElement;
    if (element?.closest("button, input, textarea, [aria-hidden='true']")) return null;
    const content = element?.closest<HTMLElement>("[data-transcript-text]");
    return content && root.contains(content) ? content : null;
  };
  const range = selection.getRangeAt(0);
  const start = body(range.startContainer), end = body(range.endContainer);
  if (!start || start !== end) return null;
  const messageId = start.closest<HTMLElement>("[data-message-id]")?.dataset.messageId;
  const text = selection.toString().trim();
  if (!messageId || !text || text.length > DRAFT_BYTES) return null;
  const bounds = root.getBoundingClientRect();
  const rect = Array.from(range.getClientRects()).find(rect => rect.width > 0 && rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom && rect.right > bounds.left && rect.left < bounds.right);
  return rect ? { messageId, text, rect } : null;
}
