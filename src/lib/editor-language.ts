export type EditorLanguage =
  | "javascript" | "typescript" | "json" | "css" | "scss" | "sass" | "less" | "html" | "vue" | "svelte"
  | "markdown" | "rust" | "python" | "env";

const EXTENSION_LANGUAGES: Record<string, EditorLanguage> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  html: "html",
  htm: "html",
  vue: "vue",
  svelte: "svelte",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  rs: "rust",
  py: "python",
};

/** The editor language for a file path; `.env` and `.env.*` files read as key=value lines. */
export function languageForPath(path: string): EditorLanguage | null {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (name === ".env" || name.startsWith(".env.")) return "env";
  const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";
  return EXTENSION_LANGUAGES[extension] ?? null;
}
