import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChatMarkdown } from "../src/lib/chat-markdown.ts";
import { lastSettledBoundary, parseChatMarkdownStream, type ChatMarkdownParse } from "../src/lib/chat-markdown-stream.ts";

const REPLY = [
  "## Plano",
  "Primeiro parágrafo\ncom duas linhas.",
  "",
  "- item um\n  continuação\n  - aninhado\n1. ordenado\n- [x] feito",
  "",
  "```ts\nconst a = 1;\n\nconst b = 2;\n```",
  "",
  "| A | B |\n|:--|--:|\n| 1 | 2 |\n| 3 | 4 |",
  "> uma nota\n> em duas linhas",
  "",
  "***",
  "texto final | com barra\n|--|--|",
  "",
  "   ",
  "1) último\n2) item",
].join("\n");

/** A small deterministic generator, so a failure names the seed that found it. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test("a streamed reply parses the same as the whole text at every cut", () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const next = random(seed);
    let parse: ChatMarkdownParse | null = null;
    let length = 0;
    while (length < REPLY.length) {
      length = Math.min(REPLY.length, length + 1 + Math.floor(next() * 12));
      const text = REPLY.slice(0, length);
      parse = parseChatMarkdownStream(parse, text);
      assert.deepEqual(parse.blocks, parseChatMarkdown(text), `seed ${seed}, length ${length}`);
    }
  }
});

test("every single cut point splits at the last blank line like the whole parse", () => {
  for (let cut = 0; cut <= REPLY.length; cut += 1) {
    const text = REPLY.slice(0, cut);
    const boundary = lastSettledBoundary(text);
    assert.deepEqual([...parseChatMarkdown(text.slice(0, boundary)), ...parseChatMarkdown(text.slice(boundary))], parseChatMarkdown(text), `cut ${cut}`);
    assert.deepEqual(parseChatMarkdownStream(null, text).blocks, parseChatMarkdown(text), `cut ${cut}`);
  }
});

test("settled blocks keep their identity; only the tail is parsed again", () => {
  const first = parseChatMarkdownStream(null, "# Título\n\nparágrafo um\n\n- a");
  const second = parseChatMarkdownStream(first, "# Título\n\nparágrafo um\n\n- a\n- b");
  assert.equal(second.boundary, first.boundary);
  assert.equal(second.settled, first.settled);
  assert.equal(second.blocks[0], first.blocks[0]);
  assert.equal(second.blocks[1], first.blocks[1]);
  assert.deepEqual(second.blocks.at(-1), { kind: "list", items: [{ depth: 0, ordered: false, number: null, text: "a", task: null }, { depth: 0, ordered: false, number: null, text: "b", task: null }] });
  const third = parseChatMarkdownStream(second, "# Título\n\nparágrafo um\n\n- a\n- b\n\n| A |\n|--|\n| 1 |");
  assert.ok(third.boundary > second.boundary);
  assert.equal(third.blocks[0], first.blocks[0]);
  assert.deepEqual(third.blocks, parseChatMarkdown(third.text));
  assert.equal(parseChatMarkdownStream(third, third.text), third);
});

test("a table or list across a blank line still parses as the whole text does", () => {
  for (const text of ["| A | B |\n|--|--|\n| 1 | 2 |\n\n| 3 | 4 |", "- a\n\n  - b\n- c", "linha\n\n|--|--|\n| x |", "a\n \t\nb"]) {
    let parse: ChatMarkdownParse | null = null;
    for (let cut = 1; cut <= text.length; cut += 1) {
      parse = parseChatMarkdownStream(parse, text.slice(0, cut));
      assert.deepEqual(parse.blocks, parseChatMarkdown(text.slice(0, cut)), JSON.stringify(text.slice(0, cut)));
    }
  }
});

test("text that shrank, changed earlier or has carriage returns is parsed whole", () => {
  const long = parseChatMarkdownStream(null, "um\n\ndois\n\ntrês");
  const shorter = parseChatMarkdownStream(long, "um\n\ndois");
  assert.deepEqual(shorter.blocks, parseChatMarkdown("um\n\ndois"));
  const rewritten = parseChatMarkdownStream(shorter, "UM\n\ndois\n\nquatro");
  assert.deepEqual(rewritten.blocks, parseChatMarkdown("UM\n\ndois\n\nquatro"));
  assert.notEqual(rewritten.blocks[0], shorter.blocks[0]);
  const crlf = parseChatMarkdownStream(rewritten, "UM\n\ndois\n\nquatro\r\n\r\n- cinco");
  assert.deepEqual(crlf.blocks, parseChatMarkdown("UM\n\ndois\n\nquatro\r\n\r\n- cinco"));
  const lone = parseChatMarkdownStream(null, "a\n \r b\n\nc");
  assert.deepEqual(lone.blocks, parseChatMarkdown("a\n \r b\n\nc"));
});
