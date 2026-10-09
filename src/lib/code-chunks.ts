/** Lines per highlighted chunk. */
const CHUNK_LINES = 40;

/**
 * Splits code into chunks of about CHUNK_LINES lines, cutting only at line breaks outside a
 * token of `tokens` (a block comment or template string never splits). A streaming code block
 * then changes only its last chunk: the others keep their string, so their memoized render is
 * reused instead of re-highlighting and re-rendering the whole block on every delta (after
 * MonoCode). Short code stays one chunk.
 */
export function codeChunks(code: string, tokens: RegExp): string[] {
  if (code.length < 2000) return [code];
  const chunks: string[] = [];
  let start = 0, lines = 0, tokenEnd = 0;
  const matches = code.matchAll(tokens);
  let next = matches.next();
  for (let index = code.indexOf("\n"); index !== -1; index = code.indexOf("\n", index + 1)) {
    // Tokens that begin before this line break: note how far the longest one reaches.
    while (!next.done && (next.value.index ?? 0) < index) {
      tokenEnd = Math.max(tokenEnd, (next.value.index ?? 0) + next.value[0].length);
      next = matches.next();
    }
    lines += 1;
    if (lines >= CHUNK_LINES && tokenEnd <= index) {
      chunks.push(code.slice(start, index + 1));
      start = index + 1;
      lines = 0;
    }
  }
  chunks.push(code.slice(start));
  return chunks;
}
