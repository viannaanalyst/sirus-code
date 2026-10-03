import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, extname } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
registerHooks({
  resolve(specifier, context, nextResolve) {
    let candidate;
    if (specifier.startsWith("@/")) candidate = resolve(root, "src", specifier.slice(2));
    else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !extname(specifier)) candidate = fileURLToPath(new URL(specifier, context.parentURL));
    if (candidate) {
      for (const path of [candidate + ".ts", resolve(candidate, "index.ts")]) {
        if (existsSync(path)) return nextResolve(pathToFileURL(path).href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
