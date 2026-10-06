import { build } from "vite";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const outDir = await mkdtemp(join(tmpdir(), "sirus-composer-metal-"));
await build({ root, build: { outDir, emptyOutDir: false, rollupOptions: { input: join(here, "index.html") } } });
let html = await readFile(join(outDir, "previews/composer-metal/index.html"), "utf8");
const script = html.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/);
const style = html.match(/<link[^>]+href="([^"]+\.css)"[^>]*>/);
if (!script || !style) throw new Error("Preview build did not produce its script and styles");
const js = await readFile(join(outDir, script[1]), "utf8");
let css = await readFile(join(outDir, style[1]), "utf8");
const mime = { ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".svg": "image/svg+xml" };
const asset = async (path) => {
  const type = Object.entries(mime).find(([ext]) => path.endsWith(ext))?.[1];
  if (!type) throw new Error(`Unexpected preview asset: ${path}`);
  return `data:${type};base64,${(await readFile(join(outDir, path))).toString("base64")}`;
};
for (const match of [...css.matchAll(/url\((?:["'])?(\/assets\/[^)"']+)(?:["'])?\)/g)]) {
  css = css.replace(match[0], `url("${await asset(match[1])}")`);
}
html = html.replace(script[0], () => `<script type="module">${js.replaceAll("</script", "<\\/script")}</script>`);
html = html.replace(style[0], () => `<style>${css}</style>`);
for (const match of [...html.matchAll(/src="(\/[^\"]+)"/g)]) {
  html = html.replace(match[0], `src="${await asset(match[1])}"`);
}
const target = join(here, "preview.html");
await writeFile(target, html);
console.log(`Standalone preview: ${target} (${Buffer.byteLength(html)} bytes)`);
