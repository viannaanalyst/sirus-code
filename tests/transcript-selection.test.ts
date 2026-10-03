import { test } from "node:test";
import assert from "node:assert/strict";
import { appendTranscriptQuote } from "../src/lib/transcript-selection.ts";

test("adding a selected passage preserves the draft and quotes every line", () => {
  assert.equal(appendTranscriptQuote("Minha pergunta", "  Primeira linha\n\nSegunda linha  "), "Minha pergunta\n\n> Primeira linha\n> \n> Segunda linha\n\n");
  assert.equal(appendTranscriptQuote("", "/uma-skill\r\n<script>literal</script>"), "> /uma-skill\n> <script>literal</script>\n\n");
  assert.equal(appendTranscriptQuote("Texto\n", "Trecho"), "Texto\n\n> Trecho\n\n");
  assert.equal(appendTranscriptQuote("Texto\n\n", "Trecho"), "Texto\n\n> Trecho\n\n");
});

test("empty passages and UTF-8 draft overflow are rejected without truncating either text", () => {
  assert.equal(appendTranscriptQuote("Rascunho", " \n\t "), null);
  assert.equal(appendTranscriptQuote("🙂".repeat(16384), "Trecho"), null);
  assert.equal(appendTranscriptQuote("", "x".repeat(65532)), "> " + "x".repeat(65532) + "\n\n");
  assert.equal(appendTranscriptQuote("", "x".repeat(65533)), null);
});
