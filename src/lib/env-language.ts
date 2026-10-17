import { StreamLanguage, type StreamParser } from "@codemirror/language";

interface EnvState { position: "key" | "value"; quote: string | null }

/** `.env` lines: `# comments`, an optional `export`, `KEY`, `=` and a plain or quoted value. */
const envParser: StreamParser<EnvState> = {
  name: "env",
  startState: () => ({ position: "key", quote: null }),
  copyState: (state) => ({ ...state }),
  token(stream, state) {
    if (state.quote) return quoted(stream, state);
    if (stream.sol()) state.position = "key";
    if (stream.eatSpace()) return null;
    if (stream.peek() === "#" && (state.position === "key" || /\s/.test(stream.string.charAt(stream.pos - 1)))) {
      stream.skipToEnd();
      return "comment";
    }
    if (state.position === "key") {
      if (stream.match(/^export(?=\s)/)) return "keyword";
      if (stream.match(/^[A-Za-z_][\w.-]*/)) return "propertyName";
      if (stream.eat(/[=:]/)) { state.position = "value"; return "operator"; }
      stream.next();
      return null;
    }
    const next = stream.peek();
    if (next === '"' || next === "'" || next === "`") {
      state.quote = stream.next() ?? null;
      return quoted(stream, state);
    }
    if (stream.match(/^\$\{[^}]*\}/) || stream.match(/^\$[A-Za-z_]\w*/)) return "variableName.special";
    stream.match(/^[^\s#$]+|^\$/);
    return "string";
  },
  languageData: { commentTokens: { line: "#" } },
};

function quoted(stream: Parameters<StreamParser<EnvState>["token"]>[0], state: EnvState): string {
  let escaped = false;
  while (!stream.eol()) {
    const char = stream.next();
    if (char === state.quote && !escaped) { state.quote = null; break; }
    escaped = !escaped && char === "\\" && state.quote !== "'";
  }
  return "string";
}

export const envLanguage = StreamLanguage.define(envParser);
