// Inlines the bundled provider marks into source.html and writes index.html.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const providers = join(here, "../../src/assets/providers");
let html = readFileSync(join(here, "source.html"), "utf8");
for (const id of ["claude", "codex", "opencode"]) {
  const svg = readFileSync(join(providers, `${id}.svg`));
  html = html.replaceAll(`{{${id}}}`, `data:image/svg+xml;base64,${svg.toString("base64")}`);
}
writeFileSync(join(here, "index.html"), html);
console.log("previews/monos/index.html");
