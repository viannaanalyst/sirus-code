import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/** Fixed bundled PDF fonts/CMaps. No remote resources or document-selected paths. */
export function pdfAssets(root: string): Plugin {
  const assets = new Map<string, Uint8Array>();
  for (const folder of ["cmaps", "standard_fonts"]) {
    const source = path.join(root, "node_modules/pdfjs-dist", folder);
    for (const name of readdirSync(source).filter((item) => /\.(bcmap|pfb|ttf)$/.test(item) || item.startsWith("LICENSE"))) {
      assets.set(`pdfjs/${folder}/${name}`, readFileSync(path.join(source, name)));
    }
  }
  assets.set("pdfjs/LICENSE", readFileSync(path.join(root, "node_modules/pdfjs-dist/LICENSE")));
  return {
    name: "sirus-local-pdf-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = request.url?.split("?")[0]?.slice(1) ?? "";
        const bytes = assets.get(name);
        if (!bytes) { next(); return; }
        response.setHeader("Content-Type", "application/octet-stream");
        response.end(bytes);
      });
    },
    generateBundle() {
      for (const [fileName, source] of assets) this.emitFile({ type: "asset", fileName, source });
    },
  };
}
