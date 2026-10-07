import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The owner does not want caps-lock text: product UI never forces capital letters.
test("product UI does not force uppercase text", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (!path.includes(join("components", "arc", "demo"))) walk(path); continue; }
      if (!/\.(css|tsx)$/.test(name)) continue;
      const source = readFileSync(path, "utf8");
      if (/text-transform:\s*uppercase|\buppercase\b(?=[^"'`]*["'`])/.test(source.replace(/toUpperCase/g, ""))) offenders.push(path);
    }
  };
  walk("src");
  assert.deepEqual(offenders, []);
});
