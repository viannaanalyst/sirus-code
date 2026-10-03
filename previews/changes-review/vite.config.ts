import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: fileURLToPath(new URL("../../public", import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  server: { host: "127.0.0.1", port: 4195, strictPort: true, fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
  build: { outDir: "dist", emptyOutDir: true, rollupOptions: { input: { main: fileURLToPath(new URL("index.html", import.meta.url)), layout: fileURLToPath(new URL("layout-fixture.html", import.meta.url)), icons: fileURLToPath(new URL("sidebar-icons.html", import.meta.url)), workspace: fileURLToPath(new URL("workspace-tools.html", import.meta.url)) } } },
});
