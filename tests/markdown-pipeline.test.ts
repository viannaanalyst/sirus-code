import { test } from "node:test";
import assert from "node:assert/strict";
import { urlTransform } from "../src/lib/markdown-pipeline.ts";
import { renderMarkdown } from "./markdown-render.ts";

test("headings, emphasis, lists, quotes, rules, tables and task lists render as elements", () => {
  const html = renderMarkdown("### Files\n\nline one\nline two\n\n- a\n  - b\n1. c\n\n> note\n\n---\n\n| A | B |\n|:--|--:|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n**bold** *it* ~~gone~~ `code`");
  for (const part of ["<h3>Files</h3>", "line one<br/>\nline two", "<ul>", "<ol>", "<blockquote>", "<hr/>", "<table>", 'style="text-align:right"', 'type="checkbox"', "<strong>bold</strong>", "<em>it</em>", "<del>gone</del>", "<code>code</code>"]) {
    assert.ok(html.includes(part), part);
  }
});

test("raw HTML is shown as text, never as markup", () => {
  const html = renderMarkdown("<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<b>hi</b>");
  assert.ok(!html.includes("<script") && !html.includes("<img") && !html.includes("<b>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("dangerous link targets are dropped", () => {
  const html = renderMarkdown("[a](javascript:alert(1)) [b](https://x.dev) [c](src/app.ts:12) [d](/tmp/shot.png) ![e](vbscript:x)");
  assert.ok(!html.includes("javascript:") && !html.includes("vbscript:"));
  assert.ok(html.includes('href="https://x.dev"') && html.includes('href="src/app.ts:12"') && html.includes('href="/tmp/shot.png"'));
});

test("autolinks, local images and https images", () => {
  const html = renderMarkdown("see https://localhost:3000/x. ![tela](https://x.dev/a.png) ![p](data:image/png;base64,AAAA) ![s](/tmp/shot.png)");
  assert.ok(html.includes('href="https://localhost:3000/x"'));
  assert.ok(html.includes('src="https://x.dev/a.png"') && html.includes('src="data:image/png;base64,AAAA"') && html.includes('src="/tmp/shot.png"'));
});

test("math: formulas become math code, prices stay text", () => {
  const html = renderMarkdown("Energy $E = mc^2$, \\(a^2\\), costs $5 and $10.\n\n$$\n\\int_0^1 x\\,dx\n$$");
  assert.ok(html.includes('<code class="language-math math-inline">E = mc^2</code>'));
  assert.ok(html.includes('<code class="language-math math-inline">a^2</code>'));
  assert.ok(html.includes("costs $5 and $10"));
  assert.ok(html.includes("math-display") && html.includes("\\int_0^1 x\\,dx"));
});

test("fenced code keeps its language class; inline backticks and math inside code are literal", () => {
  const html = renderMarkdown("```ts\nconst a = `$x$`;\n```\n\n`echo $HOME $5`");
  assert.ok(html.includes('<code class="language-ts">const a = `$x$`;\n</code>'));
  assert.ok(html.includes("<code>echo $HOME $5</code>"));
});

test("the streaming tail marks only its last prose text", () => {
  assert.ok(renderMarkdown("one\n\ntwo words", { tail: true }).endsWith('<span data-stream-tail="">two words</span></p>'));
  assert.ok(renderMarkdown("a **bold end**", { tail: true }).includes('<strong><span data-stream-tail="">bold end</span></strong>'));
  assert.ok(renderMarkdown("- a\n- b", { tail: true }).includes('<li><span data-stream-tail="">b</span></li>'));
  // Links, code and tables do not fade.
  for (const source of ["see [docs](https://a.dev)", "run `npm test`", "| A |\n|---|\n| 1 |", "```sh\nls\n```"]) {
    assert.ok(!renderMarkdown(source, { tail: true }).includes("data-stream-tail"), source);
  }
  assert.ok(!renderMarkdown("plain", {}).includes("data-stream-tail"));
});

test("urlTransform allows web, mail, file and path targets only", () => {
  for (const ok of ["https://a.dev/x?y=1#z", "http://localhost:3000", "mailto:a@b.dev", "file:///tmp/a.png", "src/a.ts", "./a.ts", "/abs/a.ts", "~/a.png", "#section", "a.ts?x=1:2"]) assert.equal(urlTransform(ok, "href"), ok, ok);
  for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html;base64,AA", "vbscript:x", "ftp:foo", ""]) assert.equal(urlTransform(bad, "href"), "", bad);
});
