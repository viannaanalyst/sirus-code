/**
 * A finished reply that asks the person to choose: a question next to a short list of
 * options at the very end ("Como aplicar? - Escolha em cada envio - Padrão permanente").
 * Agents often ask in prose instead of their native question tool; the transcript then
 * offers the options as buttons above the composer, plus "Other…".
 */
export interface ReplyChoices { question: string; options: string[] }

const ITEM = /^\s*(?:[-*•]|\d{1,2}[.)])\s+(.+?)\s*$/;
const plain = (text: string) => text.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();

export function replyChoices(content: string): ReplyChoices | null {
  const lines = content.replace(/\r\n?/g, "\n").trimEnd().split("\n");
  // The list must be the very end, after its question: a list followed by more prose (even a
  // closing question) is an explanation or examples, not options to pick from.
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end -= 1;
  const items: string[] = [];
  let start = end;
  while (start > 0 && ITEM.test(lines[start - 1])) {
    items.unshift(plain(ITEM.exec(lines[start - 1])![1]));
    start -= 1;
  }
  if (items.length < 2 || items.length > 6 || items.some((item) => !item || item.length > 160)) return null;
  // The question sits right before the list (within a couple of lines).
  let question = "";
  for (let index = start - 1, seen = 0; index >= 0 && seen < 3; index -= 1) {
    const line = lines[index].trim();
    if (!line) continue;
    seen += 1;
    const sentence = line.split(/(?<=[.!?:])\s+/).find((part) => part.includes("?"));
    if (sentence) { question = sentence; break; }
  }
  return question ? { question: plain(question), options: items } : null;
}
