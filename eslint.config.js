import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
export default [
  { ignores: ["dist/**", "src-tauri/**", "graphify-out/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: Object.fromEntries(["window", "document", "console", "HTMLElement", "HTMLButtonElement", "HTMLTextAreaElement", "HTMLInputElement", "KeyboardEvent", "ResizeObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].map((key) => [key, "readonly"])) },
    rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "error" },
  },
  { files: ["scripts/**/*.mjs", "tests/**/*.ts"], languageOptions: { globals: { URL: "readonly", process: "readonly", console: "readonly", setTimeout: "readonly" } } },
];
