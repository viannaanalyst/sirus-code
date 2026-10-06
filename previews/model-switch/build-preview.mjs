// Inlines the bundled provider marks into the source pages and writes the built previews.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const providers = join(here, "../../src/assets/providers");
const ids = ["claude", "codex", "opencode", "grok", "cursor", "antigravity", "droid", "pi", "devin"];
for (const [source, output] of [["source.html", "index.html"], ["scenes.source.html", "scenes.html"]]) {
  let html = readFileSync(join(here, source), "utf8");
  for (const id of ids) {
    const svg = readFileSync(join(providers, `${id}.svg`));
    html = html.replaceAll(`{{${id}}}`, `data:image/svg+xml;base64,${svg.toString("base64")}`);
  }
  // {{shape:id}} becomes the logo's viewBox and path list for canvas Path2D drawing.
  html = html.replace(/\{\{shape:(\w+)\}\}/g, (_, id) => {
    const svg = readFileSync(join(providers, `${id}.svg`), "utf8");
    const viewBox = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
    const paths = [...svg.matchAll(/<path([^>]*)>/g)].map(([, attrs]) => ({
      d: attrs.match(/\sd="([^"]+)"/)?.[1] ?? "",
      fill: attrs.match(/fill="([^"]+)"/)?.[1] ?? "#fff",
    })).filter((path) => path.d);
    return JSON.stringify({ viewBox, paths });
  });
  writeFileSync(join(here, output), html);
  console.log(`previews/model-switch/${output}`);
}
