import { build } from "vite";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { log } from "node:console";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const outDir = await mkdtemp(join(tmpdir(), "switchyard-dictation-"));
await build({ root, build: { outDir, emptyOutDir: false, rolldownOptions: { input: join(here, "index.html") } } });
let html = await readFile(join(outDir, "previews/dictation/index.html"), "utf8");
const script = html.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/);
const style = html.match(/<link[^>]+href="([^"]+\.css)"[^>]*>/);
if (!script || !style) throw new Error("Preview build must produce JS and CSS");
const js = await readFile(join(outDir, script[1]), "utf8");
let css = await readFile(join(outDir, style[1]), "utf8");
const mime = { ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".svg": "image/svg+xml" };
const asset = async (path) => {
  const type = mime[extname(path)];
  if (!type) throw new Error(`Unexpected asset: ${path}`);
  return `data:${type};base64,${(await readFile(join(outDir, path))).toString("base64")}`;
};
for (const match of [...css.matchAll(/url\((?:["'])?(\/assets\/[^)"']+)(?:["'])?\)/g)]) css = css.replace(match[0], `url("${await asset(match[1])}")`);
html = html.replace(script[0], () => `<script type="module">${js.replaceAll("</script", "<\\/script")}</script>`).replace(style[0], () => `<style>${css}</style>`);
for (const match of [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)]) html = html.replace(match[0], match[0].replace(match[1], await asset(match[1])));
await writeFile(join(here, "preview.html"), html);
for (const [variant, file] of [["silver", "01-linha-de-prata"], ["capsule", "02-capsula"], ["orbit", "03-orbita"], ["rails", "04-trilhos"], ["halo", "05-halo"]]) {
  await writeFile(join(here, `${file}.html`), html.replace('data-variant="silver"', `data-variant="${variant}"`));
}
log(`Built comparison and five standalone dictation previews (${Buffer.byteLength(html)} bytes each).`);
