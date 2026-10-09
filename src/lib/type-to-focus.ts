// Typing while nothing editable has focus writes in the composer (ADR-102). Focus on a
// control (a button, link, switch, tab, tree row, …) keeps its own keys: Space toggles
// a checkbox, letters drive a tree's typeahead.

/** Elements whose keys belong to them or to the widget around them. */
export const TYPING_OWNER_SELECTOR = [
  "input", "textarea", "select", "button", "a", "summary", "details", "[contenteditable]",
  "[role=dialog]", "[role=menu]", "[role=listbox]", "[role=tree]", "[role=grid]", "[role=combobox]", "[role=textbox]", "[role=searchbox]",
  "[role=button]", "[role=link]", "[role=switch]", "[role=checkbox]", "[role=tab]", "[role=menuitem]", "[role=menuitemcheckbox]", "[role=menuitemradio]",
  "[role=option]", "[role=treeitem]", "[role=slider]", "[role=spinbutton]", "[role=radio]", ".xterm",
].join(", ");

export interface TypingKey { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; isComposing?: boolean; defaultPrevented?: boolean }
export interface FocusedElement { isContentEditable?: boolean; closest(selector: string): unknown }

/**
 * Whether a printable key pressed while `active` has focus should move to the composer:
 * only when focus is on the page itself or on a non-interactive container (the transcript).
 */
export function typingGoesToComposer(event: TypingKey, active: FocusedElement | null, body: unknown = null): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return false;
  if (!active || active === body) return true;
  return !active.isContentEditable && !active.closest(TYPING_OWNER_SELECTOR);
}

/**
 * Only one composer takes redirected keys: the visible main composer of the selected
 * conversation (or of the landing when none is selected), never a side chat.
 */
export function composerOwnsTyping(composer: { sessionId: string | null; sideChat: boolean; visible: boolean }, selectedSessionId: string | null): boolean {
  return composer.visible && !composer.sideChat && composer.sessionId === selectedSessionId;
}
