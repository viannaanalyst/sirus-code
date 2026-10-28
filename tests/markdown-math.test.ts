import { test } from "node:test";
import assert from "node:assert/strict";
import { MATH_MAX, inlineMathClose, prepareMath } from "../src/lib/markdown-math.ts";

test("prices, shell variables and escaped dollars are escaped so they stay text", () => {
  assert.equal(prepareMath("costs $5 and $10"), "costs \\$5 and \\$10");
  assert.equal(prepareMath("echo $HOME and $PATH"), "echo \\$HOME and \\$PATH");
  assert.equal(prepareMath("US$5 or US$6"), "US\\$5 or US\\$6");
  assert.equal(prepareMath("$ x$"), "\\$ x\\$");
  assert.equal(prepareMath("a \\$x\\$ b"), "a \\$x\\$ b", "already escaped");
});

test("inline formulas keep their delimiters", () => {
  assert.equal(prepareMath("Energy: $E = mc^2$."), "Energy: $E = mc^2$.");
  assert.equal(prepareMath("also $$x_1$$ here"), "also $$x_1$$ here");
  assert.equal(inlineMathClose("$x$ and", 0), 2);
  assert.equal(inlineMathClose("$x $", 0), -1);
  assert.equal(inlineMathClose("$x$5", 0), -1);
});

test("\\(…\\) and \\[…\\] become $$ math", () => {
  assert.equal(prepareMath("Also \\(a^2 + b^2\\) here"), "Also $$a^2 + b^2$$ here");
  assert.equal(prepareMath("\\[ \\frac{a}{b} \\]"), "$$\n\\frac{a}{b}\n$$");
  assert.equal(prepareMath("see \\[x\\] inline"), "see $$x$$ inline");
  // Never across a blank line, and never over the size limit.
  assert.equal(prepareMath("\\(a\n\nb\\)"), "\\(a\n\nb\\)");
  const long = "x".repeat(MATH_MAX + 1);
  assert.equal(prepareMath(`\\(${long}\\)`), `\\(${long}\\)`);
});

test("display math across lines and an unclosed one at a line start are kept", () => {
  assert.equal(prepareMath("Before\n$$\n\\int_0^1 x\\,dx\n$$\nAfter"), "Before\n$$\n\\int_0^1 x\\,dx\n$$\nAfter");
  assert.equal(prepareMath("$$\nstill streaming"), "$$\nstill streaming");
  assert.equal(prepareMath("a $$ b"), "a \\$\\$ b");
});

test("fenced and inline code are never touched", () => {
  assert.equal(prepareMath("```sh\necho $HOME \\(x\\)\n```\ncosts $5"), "```sh\necho $HOME \\(x\\)\n```\ncosts \\$5");
  assert.equal(prepareMath("run `echo $HOME` then $5"), "run `echo $HOME` then \\$5");
  assert.equal(prepareMath("no math at all"), "no math at all");
});
