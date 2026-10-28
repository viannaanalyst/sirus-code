// The syntax palettes of the VS Code themes in use (ADR-185), kept apart from `diff-theme.ts` so
// the settings code can set them without loading @pierre/diffs, which stays out of the main bundle.
// `diff-theme.ts` registers whatever is here with Pierre when a diff or a code block asks.
import type { MappedTheme } from "./vscode-theme";

export type CodeAppearance = "light" | "dark";
export interface ImportedSyntax {
  /** Unique per theme and content, so a changed theme registers again under a new name. */
  name: string;
  zed: { name: string; appearance: CodeAppearance; style: Record<string, unknown> & { syntax: MappedTheme["syntax"]["syntax"] } };
}

let current: Partial<Record<CodeAppearance, ImportedSyntax>> = {};
const listeners = new Set<() => void>();

function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

const made = new WeakMap<MappedTheme, ImportedSyntax>();
/** The syntax palette Pierre reads for a mapped theme. */
export function importedSyntaxFor(mapped: MappedTheme): ImportedSyntax {
  const known = made.get(mapped);
  if (known) return known;
  const result = build(mapped);
  made.set(mapped, result);
  return result;
}

function build(mapped: MappedTheme): ImportedSyntax {
  const name = `sirus-vscode-${mapped.id}-${fingerprint(JSON.stringify(mapped.syntax))}`;
  return {
    name,
    zed: {
      name,
      appearance: mapped.kind,
      style: { background: mapped.syntax.background, text: mapped.syntax.text, "editor.background": mapped.syntax.background, "editor.foreground": mapped.syntax.text, syntax: mapped.syntax.syntax },
    },
  };
}

/** Replaces the themes in use; listeners run only when a name changed. */
export function setImportedSyntax(next: Partial<Record<CodeAppearance, ImportedSyntax>>) {
  if (current.light?.name === next.light?.name && current.dark?.name === next.dark?.name) return;
  current = { ...next };
  listeners.forEach((listener) => listener());
}

export function importedSyntax(appearance: CodeAppearance): ImportedSyntax | undefined {
  return current[appearance];
}

/** The key code colours are cached under: the imported theme's name, or `default`. */
export function codeThemeKey(appearance: CodeAppearance): string {
  return current[appearance]?.name ?? "default";
}

export function subscribeCodeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
