// Tokenizes diff segments for the viewer (ADR-145); see diff-highlight.ts.
import { tokenizeSegment, type HighlightRequest, type HighlightResponse } from "./diff-highlight";

self.onmessage = ({ data }: MessageEvent<HighlightRequest>) => {
  let response: HighlightResponse;
  try { response = { id: data.id, result: tokenizeSegment(data.payload, data.language) }; }
  catch { response = { id: data.id, result: null }; }
  const transfer = response.result ? [response.result.starts.buffer, response.result.tokens.buffer] : [];
  (self as unknown as Worker).postMessage(response, transfer);
};
