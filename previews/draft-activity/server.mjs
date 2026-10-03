import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const port = 4193;
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/preview.css", ["preview.css", "text/css; charset=utf-8"]],
  ["/preview.js", ["preview.js", "text/javascript; charset=utf-8"]],
  ["/state.mjs", ["state.mjs", "text/javascript; charset=utf-8"]],
  ...["switchyard", "wallpaper", "openai", "deepseek", "kimi", "claude"].map(name => [`/assets/${name}.svg`, [`assets/${name}.svg`, "image/svg+xml"]]),
  ["/assets/geist.woff2", ["assets/geist.woff2", "font/woff2"]],
]);
createServer(async (request, response) => {
  const file = files.get(new URL(request.url, `http://127.0.0.1:${port}`).pathname);
  if (!file || !["GET", "HEAD"].includes(request.method)) { response.writeHead(404); response.end("Not found"); return; }
  try {
    const bytes = await readFile(new URL(file[0], import.meta.url));
    response.writeHead(200, { "Content-Type": file[1], "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(request.method === "HEAD" ? undefined : bytes);
  } catch { response.writeHead(500); response.end("Preview unavailable"); }
}).listen(port, "127.0.0.1", () => console.log(`Preview ready: http://localhost:${port}/`));
