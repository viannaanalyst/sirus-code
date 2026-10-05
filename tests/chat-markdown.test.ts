import { test } from "node:test";
import assert from "node:assert/strict";
import { fileReference, parseChatInline, parseChatMarkdown } from "../src/lib/chat-markdown.ts";

test("blocks: headings, paragraphs keep line breaks, nested lists, quotes, tables", () => {
  const blocks = parseChatMarkdown("### Arquivos\nlinha um\nlinha dois\n\n- a\n  - b\n1. c\n> nota\n\n| A | B |\n|:--|--:|\n| 1 | 2 |\n---");
  assert.deepEqual(blocks.map((block) => block.kind), ["heading", "paragraph", "list", "quote", "table", "rule"]);
  assert.equal(blocks[1].kind === "paragraph" && blocks[1].text, "linha um\nlinha dois");
  const list = blocks[2].kind === "list" ? blocks[2].items : [];
  assert.deepEqual(list.map((item) => [item.depth, item.ordered, item.text]), [[0, false, "a"], [1, false, "b"], [0, true, "c"]]);
  assert.deepEqual(blocks[4].kind === "table" && [blocks[4].header, blocks[4].align, blocks[4].rows], [["A", "B"], ["left", "right"], [["1", "2"]]]);
});

test("inline: nested emphasis around code, snake_case and links", () => {
  assert.deepEqual(parseChatInline("**os IDs `x` ficam**"), [{ kind: "bold", children: [{ kind: "text", text: "os IDs " }, { kind: "code", text: "x" }, { kind: "text", text: " ficam" }] }]);
  assert.deepEqual(parseChatInline("use snake_case_name aqui"), [{ kind: "text", text: "use snake_case_name aqui" }]);
  assert.deepEqual(parseChatInline("`**not bold**`"), [{ kind: "code", text: "**not bold**" }]);
  const link = parseChatInline("veja [docs](https://github.com/a) e https://localhost:3000/x.");
  assert.deepEqual(link.map((node) => node.kind), ["text", "link", "text", "link", "text"]);
  assert.deepEqual(parseChatInline("2 * 3 * 4"), [{ kind: "text", text: "2 * 3 * 4" }]);
});

test("file references are relative workspace paths that look like files", () => {
  assert.deepEqual(fileReference("src/api/orders.js", "/w"), { path: "src/api/orders.js", line: null });
  assert.deepEqual(fileReference("src/ui/OrdersPage.js:12", "/w"), { path: "src/ui/OrdersPage.js", line: 12 });
  assert.deepEqual(fileReference("README.md", "/w"), { path: "README.md", line: null });
  assert.deepEqual(fileReference("/w/package.json", "/w"), { path: "package.json", line: null });
  assert.deepEqual(fileReference("src/", "/w"), { path: "src", line: null });
  for (const value of ["listOrders", "node --test", "/etc/passwd", "../secret.txt", "https://a.b/c.js", "v1.2", "a//b.js"]) assert.equal(fileReference(value, "/w"), null, value);
});
