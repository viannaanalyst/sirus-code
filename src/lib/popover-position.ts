type Anchor = { getBoundingClientRect: () => Pick<DOMRect, "top"> } | null;
/** Read once on open. Keep the horizontal trigger anchor, placing the panel above the composer. */
export function popoverOffsetAbove(trigger: Anchor, boundary: Anchor, gap = 10) {
  if (!trigger || !boundary) return 6;
  return Math.max(6, trigger.getBoundingClientRect().top - boundary.getBoundingClientRect().top + gap);
}

/** Align wide composer menus with the complete input, not the small toolbar button. */
export function composerPopoverLayout(trigger: HTMLElement | null, boundary: HTMLElement | null) {
  if (!trigger || !boundary) return { sideOffset: 6, alignOffset: 0, width: 320 };
  const control = trigger.getBoundingClientRect();
  const composer = boundary.getBoundingClientRect();
  return { sideOffset: popoverOffsetAbove(trigger, boundary), alignOffset: composer.left - control.left, width: composer.width };
}
