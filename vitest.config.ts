import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Only the Ghostty terminal tests run here: they need Vite's `?raw`/`?inline` asset imports and
// mocks. Every other test uses `node --test` (see `npm test`).
export default defineConfig({
  assetsInclude: ["**/*.wasm", "**/*.woff2"],
  resolve: { alias: { "@": path.resolve(dirname, "./src") } },
  test: { include: ["src/terminal/**/*.test.ts"], environment: "node" },
});
