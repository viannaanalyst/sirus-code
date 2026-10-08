/**
 * The floating Astro chat's rail (ADR-088): beside the chat when the window is
 * wide enough, behind a toggle when it is narrow.
 */
export const ASTRO_FLOAT_RAIL_BREAKPOINT = 460;

export type AstroFloatRailMode = "beside" | "toggle";

export function astroFloatRailMode(width: number): AstroFloatRailMode {
  return width >= ASTRO_FLOAT_RAIL_BREAKPOINT ? "beside" : "toggle";
}

/** The Astro the float shows: the chosen one while it exists, else the first one left. */
export function astroFloatCurrent(chosen: string, astros: readonly { id: string }[] | null): string {
  if (!astros || astros.some((astro) => astro.id === chosen)) return chosen;
  return astros[0]?.id ?? chosen;
}
