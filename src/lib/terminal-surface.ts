/**
 * The terminal paints the surface it sits on (2026-10-09): xterm needs a concrete colour, and a
 * fixed one (#0c0c0c) left the terminal darker than the dock beside a started conversation,
 * which uses the sidebar material. `backgrounds` are computed `background-color`s from the
 * terminal outwards; the first painted one decides.
 */
export interface Rgba { r: number; g: number; b: number; a: number }

export function parseCssColor(value: string): Rgba | null {
  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(value.trim());
  if (!match) return null;
  const alpha = match[4] === undefined ? 1 : match[4].endsWith("%") ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
  return { r: Math.round(+match[1]), g: Math.round(+match[2]), b: Math.round(+match[3]), a: alpha };
}

const hex = (value: number) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");

/** `transparent` when the surface lets the window show through: xterm then composes over it. */
export function terminalSurface(backgrounds: string[], fallback: string): { background: string; transparent: boolean } {
  for (const value of backgrounds) {
    const color = parseCssColor(value);
    if (!color || color.a === 0) continue;
    const solid = `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
    // Translucent surfaces keep their tint at zero alpha, so reverse video is never black.
    return color.a >= 0.999 ? { background: solid, transparent: false } : { background: `${solid}00`, transparent: true };
  }
  return { background: fallback, transparent: fallback.length === 9 };
}
