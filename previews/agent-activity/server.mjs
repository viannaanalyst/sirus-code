import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const directory = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.SIRUS_PREVIEW_PORT || 4178);
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/preview.css", ["preview.css", "text/css; charset=utf-8"]],
  ["/preview.js", ["preview.js", "text/javascript; charset=utf-8"]],
  ["/assets/geist.woff2", ["assets/geist.woff2", "font/woff2"]],
  ["/assets/geist-mono.woff2", ["assets/geist-mono.woff2", "font/woff2"]],
  ["/assets/codex.svg", ["assets/codex.svg", "image/svg+xml"]],
  ["/assets/sirus.svg", ["assets/sirus.svg", "image/svg+xml"]],
  ["/assets/wallpaper.svg", ["assets/wallpaper.svg", "image/svg+xml"]],
]);
createServer(async (request, response) => {
  const file = files.get(new URL(request.url, `http://127.0.0.1:${port}`).pathname);
  if (!file || !["GET", "HEAD"].includes(request.method)) { response.writeHead(404); response.end("Not found"); return; }
  try {
    const bytes = await readFile(path.join(directory, file[0]));
    response.writeHead(200, { "Content-Type":file[1], "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff", "Referrer-Policy":"no-referrer" });
    response.end(request.method === "HEAD" ? undefined : bytes);
  } catch { response.writeHead(500); response.end("Preview unavailable"); }
}).listen(port,"127.0.0.1",() => console.log(`Preview ready: http://localhost:${port}/`));
