// The app's lightweight syntax highlighter: one regex pass that classifies tokens. Code blocks
// render it directly; diffs run it in a web worker (diff-highlight.worker.ts), so both colour
// source text the same way with the same classes (code-block.module.css).

export const TOKEN_KINDS = ["comment", "string", "number", "keyword", "type", "function", "property", "tag", "punctuation"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

const keywordPattern = /^(?:abstract|as|async|await|break|case|catch|class|const|continue|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|of|private|protected|public|readonly|return|set|static|switch|throw|try|type|typeof|var|void|while|with|yield|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE)$/;
const literalPattern = /^(?:true|false|null|undefined|NaN|Infinity)$/;
const typePattern = /^(?:Array|Boolean|Date|Error|Map|Number|Promise|Record|Set|String|ReactNode|HTMLElement|HTMLButtonElement|Event|unknown|never|void|any|boolean|number|string|object)$/;
export const tokenPattern = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|<!--[\s\S]*?-->|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$-]*\b|[{}[\]();,.<>:=+*/!?|&-]/g;

export function normaliseLanguage(language: string) {
  return language.toLowerCase().replace(/^\./, "");
}

// Sticky patterns test the text right after a token without slicing the rest of the
// source, keeping highlighting linear in the code length.
const followedByColon = /\s*:/y;
const followedByCall = /\s*\(/y;
const followedByAssign = /\s*[:=]/y;
function followedBy(pattern: RegExp, source: string, position: number) {
  pattern.lastIndex = position;
  return pattern.test(source);
}

export function tokenKind(value: string, source: string, index: number, language: string): TokenKind | undefined {
  const end = index + value.length;
  if (value.startsWith("//") || value.startsWith("/*") || value.startsWith("<!--")) return "comment";
  if (value.startsWith("\"") || value.startsWith("'") || value.startsWith("`")) {
    return language === "json" && followedBy(followedByColon, source, end) ? "property" : "string";
  }
  if (/^\d/.test(value)) return "number";
  if (keywordPattern.test(value) || literalPattern.test(value)) return "keyword";
  if (typePattern.test(value)) return "type";
  if (/^[{}[\]();,.<>:=+*/!?|&-]$/.test(value)) return "punctuation";
  // A tag name follows "<" or "</": two characters of context are enough.
  const before = source.slice(Math.max(0, index - 2), index);
  if ((language === "tsx" || language === "jsx" || language === "html" || language === "vue") && /<\/?$/.test(before)) return "tag";
  if (language !== "json" && followedBy(followedByCall, source, end)) return "function";
  if ((language === "css" || language === "tsx" || language === "jsx") && followedBy(followedByAssign, source, end)) return "property";
  return undefined;
}

/** Classified tokens of `code` in order: [start, end) offsets and their kind. */
export function* codeTokens(code: string, language: string): Generator<{ start: number; end: number; kind: TokenKind }> {
  for (const match of code.matchAll(tokenPattern)) {
    const start = match.index ?? 0;
    const kind = tokenKind(match[0], code, start, language);
    if (kind) yield { start, end: start + match[0].length, kind };
  }
}

/** File extensions whose diffs are coloured; prose, data and unknown files stay plain. */
const CODE_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "json", "jsonc", "css", "scss", "sass", "less", "html", "htm", "vue", "svelte", "astro", "rs", "py", "go", "java", "kt", "kts", "swift", "c", "h", "cc", "cpp", "hpp", "m", "mm", "cs", "rb", "php", "sh", "bash", "zsh", "sql", "dart", "scala", "lua", "zig"]);

/** The highlighter language for a path, or null when the file is not source code. */
export function languageForPath(path: string): string | null {
  const name = path.slice(path.replaceAll("\\", "/").lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const extension = normaliseLanguage(name.slice(dot + 1));
  return CODE_EXTENSIONS.has(extension) ? extension : null;
}
