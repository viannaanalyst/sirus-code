/** New project from a name (T3 #14527). The folder name mirrors `slug` in `new_project.rs`. */
export const DEFAULT_PROJECT_PARENT = "~/Projetos";
const PARENT_KEY = "sirus.newProjectParent";

const FOLD: Record<string, string> = { á: "a", à: "a", â: "a", ã: "a", ä: "a", å: "a", é: "e", è: "e", ê: "e", ë: "e", í: "i", ì: "i", î: "i", ï: "i", ó: "o", ò: "o", ô: "o", õ: "o", ö: "o", ú: "u", ù: "u", û: "u", ü: "u", ç: "c", ñ: "n" };

export function projectSlug(name: string): string | null {
  let out = "";
  for (const char of name.trim().toLowerCase()) {
    const c = FOLD[char] ?? char;
    if (/^[a-z0-9]$/.test(c)) out += c;
    else if (out && !out.endsWith("-")) out += "-";
  }
  out = out.slice(0, 64).replace(/^-+|-+$/g, "");
  return out || null;
}

export function validProjectName(name: string): boolean {
  const trimmed = name.trim();
  // eslint-disable-next-line no-control-regex
  return trimmed.length > 0 && [...trimmed].length <= 100 && !/[\u0000-\u001f\u007f]/.test(trimmed) && projectSlug(trimmed) !== null;
}

/** Where the folder will be created, for the preview line. */
export function projectTarget(parent: string, name: string): string | null {
  const slug = projectSlug(name);
  const base = parent.trim().replace(/\/+$/, "");
  return slug && base ? `${base}/${slug}` : null;
}

export function lastProjectParent(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): string {
  try { return storage?.getItem(PARENT_KEY)?.trim() || DEFAULT_PROJECT_PARENT; } catch { return DEFAULT_PROJECT_PARENT; }
}

export function rememberProjectParent(parent: string, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage) {
  try { storage?.setItem(PARENT_KEY, parent.trim()); } catch { /* storage unavailable: keep the default */ }
}
