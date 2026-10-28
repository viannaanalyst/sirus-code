/**
 * The mounted prompt editors by draft owner (`session:<id>` or `project:<id>`, ADR-168).
 * Other surfaces focus the composer or write into it through this registry instead of
 * reaching into its DOM, so the editor can change without touching them.
 */
export interface ComposerHandle {
  owner: string;
  /** The editable element, used to find the composer inside a pane. */
  element: HTMLElement | null;
  /** Moves focus in; `end` also puts the caret after the last character. */
  focus(options?: { preventScroll?: boolean; end?: boolean }): void;
  /** Inserts `text` at the selection. */
  insert(text: string): void;
  /** Replaces the characters from `start` to `end` (plain-text offsets) and puts the caret after `text`. */
  replaceRange(start: number, end: number, text: string): void;
  /** Moves the caret to a plain-text offset. */
  setCaret(offset: number): void;
  /** The draft exactly as it is stored. */
  text(): string;
  /** The selection as plain-text offsets. */
  selection(): { start: number; end: number };
  editable(): boolean;
  /** Whether the editor is laid out on screen (a hidden pane keeps its editor mounted). */
  visible(): boolean;
}

const handles = new Map<string, ComposerHandle[]>();

/** Adds a mounted editor; the returned function removes it. */
export function registerComposer(handle: ComposerHandle): () => void {
  handles.set(handle.owner, [...(handles.get(handle.owner) ?? []), handle]);
  return () => {
    const rest = (handles.get(handle.owner) ?? []).filter(item => item !== handle);
    if (rest.length) handles.set(handle.owner, rest); else handles.delete(handle.owner);
  };
}

/** The editor of `owner`; when several are mounted (split panes) the visible one registered last. */
export function composerFor(owner: string): ComposerHandle | null {
  const list = handles.get(owner) ?? [];
  return [...list].reverse().find(item => item.visible()) ?? list.at(-1) ?? null;
}

/** The editor mounted inside `scope` (a pane or the section around a transcript). */
export function composerWithin(scope: Element | null | undefined): ComposerHandle | null {
  if (!scope) return null;
  for (const list of handles.values()) {
    const found = list.find(item => item.element !== null && scope.contains(item.element));
    if (found) return found;
  }
  return null;
}

export interface FocusComposerOptions { preventScroll?: boolean; end?: boolean }

/** Focuses the composer of `owner`; false when none is mounted. */
export function focusComposer(owner: string, options?: FocusComposerOptions): boolean {
  const handle = composerFor(owner);
  if (!handle) return false;
  handle.focus(options);
  return true;
}

/** Writes `text` into the composer of `owner` at its selection; false when none is mounted or it is disabled. */
export function insertIntoComposer(owner: string, text: string): boolean {
  const handle = composerFor(owner);
  if (!handle || !handle.editable()) return false;
  handle.insert(text);
  return true;
}
