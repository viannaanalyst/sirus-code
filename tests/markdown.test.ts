import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseMarkdown } from "../src/lib/markdown.ts";

test("markdown blocks: headings, paragraphs, lists, quotes, fences and rules", () => {
  const source = [
    "# Title",
    "",
    "Some **bold** and `code` text.",
    "",
    "- one",
    "- two",
    "",
    "1. first",
    "2. second",
    "",
    "> quoted",
    "",
    "```ts",
    "const a = 1;",
    "```",
    "",
    "---",
  ].join("\n");
  const blocks = parseMarkdown(source);
  assert.deepEqual(blocks.map((block) => block.kind), ["heading", "paragraph", "list", "list", "quote", "code", "rule"]);
  const heading = blocks[0] as { kind: "heading"; level: number; text: string };
  assert.equal(heading.level, 1);
  assert.equal(heading.text, "Title");
  const code = blocks[5] as { kind: "code"; language: string; content: string };
  assert.equal(code.language, "ts");
  assert.equal(code.content, "const a = 1;");
  assert.equal((blocks[2] as { ordered: boolean }).ordered, false);
  assert.equal((blocks[3] as { ordered: boolean }).ordered, true);
});

test("inline tokens: bold, italic, code and links", () => {
  const tokens = parseInline("a **b** *c* `d` [e](https://x.dev) f");
  assert.deepEqual(tokens, [
    { kind: "text", text: "a " },
    { kind: "bold", text: "b" },
    { kind: "text", text: " " },
    { kind: "italic", text: "c" },
    { kind: "text", text: " " },
    { kind: "code", text: "d" },
    { kind: "text", text: " " },
    { kind: "link", text: "e", url: "https://x.dev" },
    { kind: "text", text: " f" },
  ]);
  assert.deepEqual(parseInline("plain"), [{ kind: "text", text: "plain" }]);
});
