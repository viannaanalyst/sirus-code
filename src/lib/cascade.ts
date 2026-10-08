import { useEffect, useState, type CSSProperties } from "react";

/** Rows past this position share its delay, so long lists never wait (the shared CSS caps it too). */
export const CASCADE_CAP = 10;
/**
 * How long a surface that just opened keeps `data-cascade`: the lead, ten stagger steps and one
 * row's entrance (40 + 10 × 22 + 320 ms), with a margin. Rows that mount later, such as search
 * results or late data, appear without the cascade.
 */
export const CASCADE_WINDOW_MS = 640;

/** True while a surface that just opened may cascade its rows; it re-arms each time `open` turns true. */
export function useCascade(open = true): boolean {
  const [state, setState] = useState({ open, armed: open });
  if (state.open !== open) setState({ open, armed: open });
  useEffect(() => {
    if (!state.armed) return;
    const timer = setTimeout(() => setState(current => ({ ...current, armed: false })), CASCADE_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [state.armed]);
  return state.armed;
}

/** Position of a `data-cascade-item` row, written inline when the rows are mapped. */
export function cascadeIndex(index: number): CSSProperties {
  return { "--cascade-index": Math.min(index, CASCADE_CAP) } as CSSProperties;
}
