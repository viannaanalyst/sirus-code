import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdownBlocks, splitMarkdownBlocks, type MarkdownBlocks } from "../src/lib/markdown-blocks.ts";

test("blocks end at blank lines; blank lines belong to no block", () => {
  assert.deepEqual(splitMarkdownBlocks("# Title\n\nOne\ntwo\n\n\n\nThree"), ["# Title", "One\ntwo", "Three"]);
  assert.deepEqual(splitMarkdownBlocks(""), []);
  assert.deepEqual(splitMarkdownBlocks("\n\n  \n"), []);
  assert.deepEqual(splitMarkdownBlocks("only"), ["only"]);
});

test("a fenced code block with blank lines is one block, even unclosed", () => {
  assert.deepEqual(splitMarkdownBlocks("```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nafter"), ["```ts\nconst a = 1;\n\nconst b = 2;\n```", "after"]);
  assert.deepEqual(splitMarkdownBlocks("before\n\n```ts\nx\n\ny"), ["before", "```ts\nx\n\ny"]);
  // A longer fence is not closed by a shorter one, and a tilde fence not by backticks.
  assert.deepEqual(splitMarkdownBlocks("````md\n```\n\n```\n````\n\nnext"), ["````md\n```\n\n```\n````", "next"]);
  assert.deepEqual(splitMarkdownBlocks("~~~\na\n```\n\nb\n~~~\n\nc"), ["~~~\na\n```\n\nb\n~~~", "c"]);
  // An inline triple tick is not a fence.
  assert.deepEqual(splitMarkdownBlocks("a ```x``` b\n\nc"), ["a ```x``` b", "c"]);
});

test("lists stay whole across blank lines, indented continuations and fences inside items", () => {
  assert.deepEqual(splitMarkdownBlocks("- a\n\n- b\n\n  more of b\n\nParagraph"), ["- a\n\n- b\n\n  more of b", "Paragraph"]);
  assert.deepEqual(splitMarkdownBlocks("1. one\n\n2. two\n\ntext"), ["1. one\n\n2. two", "text"]);
  assert.deepEqual(splitMarkdownBlocks("- item\n\n  ```sh\n  a\n\n  b\n  ```\n\n- next\n\nend"), ["- item\n\n  ```sh\n  a\n\n  b\n  ```\n\n- next", "end"]);
  // A paragraph followed by a list after a blank line is two blocks.
  assert.deepEqual(splitMarkdownBlocks("text\n\n- a\n- b"), ["text", "- a\n- b"]);
});

test("display math is one block, however it is delimited", () => {
  assert.deepEqual(splitMarkdownBlocks("$$\na\n\nb\n$$\n\nafter"), ["$$\na\n\nb\n$$", "after"]);
  assert.deepEqual(splitMarkdownBlocks("\\[\na\n\nb\n\\]\n\nafter"), ["\\[\na\n\nb\n\\]", "after"]);
  assert.deepEqual(splitMarkdownBlocks("$$x$$\n\nafter"), ["$$x$$", "after"], "a formula closed on its own line does not open math");
  assert.deepEqual(splitMarkdownBlocks("\\[x\\]\n\nafter"), ["\\[x\\]", "after"]);
});

test("reference definitions keep the whole text in one block", () => {
  assert.deepEqual(splitMarkdownBlocks("see [docs]\n\n[docs]: https://a.dev"), ["see [docs]\n\n[docs]: https://a.dev"]);
});

test("carriage returns are split whole", () => {
  assert.deepEqual(splitMarkdownBlocks("a\r\n\r\nb"), ["a\r\n\r\nb"]);
});

const REPLY = [
  "## Plan",
  "",
  "First paragraph\nwith two lines.",
  "",
  "- one\n  continued\n  - nested\n\n- two\n- [x] done",
  "",
  "```ts\nconst a = 1;\n\nconst b = 2;\n```",
  "",
  "| A | B |\n|:--|--:|\n| 1 | 2 |",
  "",
  "> a note\n> on two lines",
  "",
  "$$\n\\int_0^1 x\\,dx\n\n= 1/2\n$$",
  "",
  "1) last\n2) item",
].join("\n");

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test("a streamed reply splits the same as the whole text at every cut", () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const next = random(seed);
    let parse: MarkdownBlocks | null = null;
    let length = 0;
    while (length < REPLY.length) {
      length = Math.min(REPLY.length, length + 1 + Math.floor(next() * 12));
      const text = REPLY.slice(0, length);
      parse = parseMarkdownBlocks(parse, text);
      assert.deepEqual(parse.blocks, splitMarkdownBlocks(text), `seed ${seed}, length ${length}`);
    }
  }
});

test("a settled block never changes as the reply grows", () => {
  const whole = splitMarkdownBlocks(REPLY);
  for (let length = 1; length <= REPLY.length; length += 1) {
    const blocks = splitMarkdownBlocks(REPLY.slice(0, length));
    assert.deepEqual(blocks.slice(0, -1), whole.slice(0, blocks.length - 1), `length ${length}`);
  }
});

test("settled blocks keep their identity while the tail grows", () => {
  const first = parseMarkdownBlocks(null, "# A\n\nsecond\n\nthi");
  const second = parseMarkdownBlocks(first, "# A\n\nsecond\n\nthird");
  assert.equal(second.blocks.length, 3);
  assert.equal(second.blocks[0], first.blocks[0]);
  assert.equal(second.blocks[1], first.blocks[1]);
  assert.equal(second.blocks[2], "third");
  assert.equal(second.tailStart, "# A\n\nsecond\n\n".length);
  // The same text returns the same parse.
  assert.equal(parseMarkdownBlocks(second, "# A\n\nsecond\n\nthird"), second);
});

test("only the tail is scanned again: a long settled prefix is never re-read", () => {
  const settled = Array.from({ length: 200 }, (_, index) => `paragraph ${index}`).join("\n\n");
  const first = parseMarkdownBlocks(null, `${settled}\n\ntail`);
  const second = parseMarkdownBlocks(first, `${settled}\n\ntail grows`);
  assert.equal(second.tailStart, first.tailStart);
  assert.equal(second.blocks.length, 201);
  for (let index = 0; index < 200; index += 1) assert.equal(second.blocks[index], first.blocks[index]);
});

test("text that is not an extension, or that shrank, is split whole", () => {
  const first = parseMarkdownBlocks(null, "a\n\nb\n\nc");
  assert.deepEqual(parseMarkdownBlocks(first, "x\n\ny").blocks, ["x", "y"]);
  assert.deepEqual(parseMarkdownBlocks(first, "a\n\nb").blocks, ["a", "b"]);
});

test("a fence that closes later merges the blocks it swallowed", () => {
  const open = parseMarkdownBlocks(null, "```\ncode\n\nmore");
  assert.deepEqual(open.blocks, ["```\ncode\n\nmore"]);
  const closed = parseMarkdownBlocks(open, "```\ncode\n\nmore\n```\n\nafter");
  assert.deepEqual(closed.blocks, ["```\ncode\n\nmore\n```", "after"]);
});
