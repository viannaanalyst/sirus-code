import assert from "node:assert/strict";
import { test } from "node:test";
import { codeChunks } from "../src/lib/code-chunks.ts";

const tokens = /\/\*[\s\S]*?\*\/|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|\b\w+\b/g;

test("short code stays whole; long code splits at line breaks and joins back exactly", () => {
  assert.deepEqual(codeChunks("const a = 1;", tokens), ["const a = 1;"]);
  const code = Array.from({ length: 200 }, (_, line) => `const value${line} = "line ${line}";`).join("\n");
  const chunks = codeChunks(code, tokens);
  assert.equal(chunks.join(""), code);
  assert.equal(chunks.length, 5);
  assert.ok(chunks.slice(0, -1).every((chunk) => chunk.endsWith("\n") && chunk.split("\n").length - 1 === 40));
});

test("a block comment or template string is never cut, and a growing tail keeps earlier chunks", () => {
  const head = Array.from({ length: 39 }, (_, line) => `x${line}`).join("\n");
  const code = `${head}\n/* one\ntwo\nthree */\n${Array.from({ length: 80 }, (_, line) => `y${line} = ${"z".repeat(30)}`).join("\n")}`;
  const chunks = codeChunks(code, tokens);
  assert.equal(chunks.join(""), code);
  assert.ok(chunks.every((chunk) => (chunk.match(/\/\*/g)?.length ?? 0) === (chunk.match(/\*\//g)?.length ?? 0)));
  const longer = codeChunks(`${code}\nmore = 1`, tokens);
  assert.deepEqual(longer.slice(0, chunks.length - 1), chunks.slice(0, -1));
});
