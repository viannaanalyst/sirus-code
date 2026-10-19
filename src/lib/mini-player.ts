// Placement of the floating agent-page player over the conversation (ADR-151).
// Pure geometry: the component measures its container and feeds these helpers.

export type PlayerCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export interface PlayerBox { width: number; height: number }
export interface PlayerPoint { x: number; y: number }

/** The preferred size of the player; it shrinks to fit a narrow or short conversation. */
export const MINI_PLAYER_SIZE: PlayerBox = { width: 360, height: 240 };
export const MINI_PLAYER_MARGIN = 12;
const MIN_WIDTH = 160;

/** The player's size in a container: the preferred size, scaled down to fit inside the margins and `bottomInset`. */
export function miniPlayerSize(container: PlayerBox, bottomInset = 0, preferred: PlayerBox = MINI_PLAYER_SIZE): PlayerBox {
  const availableWidth = container.width - MINI_PLAYER_MARGIN * 2;
  const availableHeight = container.height - MINI_PLAYER_MARGIN * 2 - Math.max(0, bottomInset);
  const scale = Math.min(1, availableWidth / preferred.width, availableHeight / preferred.height);
  const width = Math.max(Math.min(MIN_WIDTH, availableWidth), preferred.width * scale);
  return { width: Math.round(width), height: Math.round(width * preferred.height / preferred.width) };
}

/** Top-left position of the player in a corner, clear of the margins and the bottom inset. */
export function cornerPosition(corner: PlayerCorner, container: PlayerBox, player: PlayerBox, bottomInset = 0): PlayerPoint {
  const left = MINI_PLAYER_MARGIN;
  const right = Math.max(left, container.width - player.width - MINI_PLAYER_MARGIN);
  const top = MINI_PLAYER_MARGIN;
  const bottom = Math.max(top, container.height - player.height - MINI_PLAYER_MARGIN - Math.max(0, bottomInset));
  return { x: corner.endsWith("left") ? left : right, y: corner.startsWith("top") ? top : bottom };
}

/** Keeps a dragged player inside the container's margins. */
export function clampPlayerPosition(point: PlayerPoint, container: PlayerBox, player: PlayerBox, bottomInset = 0): PlayerPoint {
  const [minX, maxX] = [MINI_PLAYER_MARGIN, Math.max(MINI_PLAYER_MARGIN, container.width - player.width - MINI_PLAYER_MARGIN)];
  const [minY, maxY] = [MINI_PLAYER_MARGIN, Math.max(MINI_PLAYER_MARGIN, container.height - player.height - MINI_PLAYER_MARGIN - Math.max(0, bottomInset))];
  return { x: Math.min(maxX, Math.max(minX, point.x)), y: Math.min(maxY, Math.max(minY, point.y)) };
}

/** The corner the player's centre is nearest to when a drag ends. */
export function nearestCorner(point: PlayerPoint, container: PlayerBox, player: PlayerBox, bottomInset = 0): PlayerCorner {
  const centreX = point.x + player.width / 2;
  const centreY = point.y + player.height / 2;
  const horizontal = centreX < container.width / 2 ? "left" : "right";
  const vertical = centreY < (container.height - Math.max(0, bottomInset)) / 2 ? "top" : "bottom";
  return `${vertical}-${horizontal}` as PlayerCorner;
}

/**
 * Whether the player shows a page: one is revealed, the browser is open on a real page, and the dock's
 * browser pane is not already showing the session (ADR-151). A picture-in-picture window holds the tab.
 */
export function agentPageShows(input: { revealed: boolean; browserOpen: boolean; pageLoaded: boolean; pictureInPicture: boolean; dockShowing: boolean }): boolean {
  return input.revealed && input.browserOpen && input.pageLoaded && !input.pictureInPicture && !input.dockShowing;
}
