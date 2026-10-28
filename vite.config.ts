import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { defineConfig, type Plugin } from "vite";
import { pdfAssets } from "./scripts/pdf-assets.ts";
import { appAbout } from "./scripts/app-about.ts";

const host = process.env.TAURI_DEV_HOST;
const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * React Compiler (ADR-183): on for builds and tests, opt-in in dev with SIRUS_DEV_REACT_COMPILER=1
 * because the biggest components make the dev transform slow.
 */
function reactCompiler(): Promise<Plugin> {
  return babel({
    parserOpts: { plugins: ["typescript", "jsx"] },
    presets: [reactCompilerPreset()],
  }).then((plugin) => ({
    ...plugin,
    apply: (_config, { command, mode }) =>
      command === "build" ||
      mode === "test" ||
      /^(1|true)$/i.test(process.env.SIRUS_DEV_REACT_COMPILER?.trim() ?? ""),
  }));
}

export default defineConfig(() => ({
  plugins: [
    react(),
    reactCompiler(),
    tailwindcss(),
    pdfAssets(dirname),
    buildStamp(),
  ],
  // Version and open source licenses for the phone's About pages (ADR-130).
  define: { __SIRUS_ABOUT__: JSON.stringify(appAbout(dirname)) },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));

/** When the build was made, in the page: the native app only takes newer builds (ADR-134). */
function buildStamp(): Plugin {
  const stamp = String(Date.now());
  return {
    name: "sirus-build-stamp",
    transformIndexHtml: (html) =>
      html.replace(
        "<head>",
        `<head>\n    <meta name="sirus-build" content="${stamp}" />`,
      ),
  };
}
