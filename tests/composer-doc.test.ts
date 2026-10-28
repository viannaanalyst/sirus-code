import assert from "node:assert/strict";
import { test } from "node:test";
import { getSchema } from "@tiptap/core";
import { composerExtensions } from "../src/lib/composer-extensions.ts";
import { chipLabel, filePathOf } from "../src/lib/composer-chip.ts";
import { docToText, findChipEdits, offsetAtPos, posAtOffset, textToDoc, textToFragment } from "../src/lib/composer-doc.ts";
import { activeComposerTrigger } from "../src/lib/composer-suggestions.ts";

const schema = getSchema(composerExtensions);
const docOf = (text: string) => schema.nodeFromJSON(textToDoc(text));
const kinds = (text: string) => docOf(text).firstChild!.children.map(node => node.type.name === "composerChip" ? `${node.attrs.kind}:${node.attrs.text}` : node.type.name === "hardBreak" ? "\n" : node.text);

test("a draft survives string to document to string, tokens and newlines included", () => {
  for (const text of [
    "",
    "plain words",
    "fix @src/a.ts and /review now",
    "line one\nline two\n\nline four\n",
    "\n\nleading and trailing\n\n",
    'open @"my dir/notes file.md" then see https://github.com/acme/app/pull/12.',
    "bare portal.gov.br/api and /usr/bin/env stay as typed",
    "emoji 😀 @src/😀.ts 👨‍👩‍👧 done",
    "tab\tand  double  spaces",
    "/compact",
    "email me@example.com / slash",
  ]) assert.equal(docToText(docOf(text)), text, JSON.stringify(text));
});

test("tokens and web addresses become chips; paths and emails stay text", () => {
  assert.deepEqual(kinds("fix @src/a.ts with /review"), ["fix ", "file:@src/a.ts", " with ", "skill:/review"]);
  assert.deepEqual(kinds("a\n/b c"), ["a", "\n", "skill:/b", " c"]);
  assert.deepEqual(kinds("see https://github.com/acme/app/pull/12"), ["see ", "link:https://github.com/acme/app/pull/12"]);
  assert.deepEqual(kinds("/usr/bin me@example.com"), ["/usr/bin me@example.com"]);
  assert.deepEqual(kinds(""), []);
});

test("chips read as a short label, never as the typed characters", () => {
  assert.equal(chipLabel("file", "@src/lib/a.ts"), "a.ts");
  assert.equal(chipLabel("file", "@src/lib/"), "lib/");
  assert.equal(chipLabel("file", '@"my dir/notes file.md"'), "notes file.md");
  assert.equal(filePathOf('@"a \\"b\\".md"'), 'a "b".md');
  assert.equal(chipLabel("skill", "/review"), "/review");
  assert.equal(chipLabel("link", "https://github.com/acme/app/pull/12"), "acme/app#12");
});

test("plain-text offsets and document positions map both ways around chips, breaks and emoji", () => {
  const text = "go @src/a.ts 😀\nend";
  const doc = docOf(text);
  assert.equal(offsetAtPos(doc, 1), 0);
  // "go " is 3 characters, the chip is the 9 of "@src/a.ts".
  assert.equal(offsetAtPos(doc, 1 + 3), 3);
  assert.equal(offsetAtPos(doc, 1 + 3 + 1), 3 + "@src/a.ts".length);
  for (const offset of [0, 3, 12, 13, 15, 16, 17, text.length]) {
    const pos = posAtOffset(doc, offset);
    assert.equal(offsetAtPos(doc, pos), offset, `offset ${offset}`);
  }
  // Inside a chip the caret can only land after it.
  assert.equal(posAtOffset(doc, 6), 1 + 3 + 1);
  assert.equal(posAtOffset(doc, 9999), doc.firstChild!.nodeSize - 1, "past the end lands at the end of the paragraph");
});

test("text written into the editor keeps its characters and line breaks", () => {
  const paragraph = schema.nodes.paragraph.create(null, textToFragment(schema, "a\r\nb\n\nc @x"));
  assert.equal(docToText(schema.nodes.doc.create(null, paragraph)), "a\nb\n\nc @x");
});

test("a token becomes a chip only once the caret has left it", () => {
  const plain = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, schema.text("fix @src/a.ts now /rev")));
  // Positions: paragraph content starts at 1. The caret at the end touches "/rev"; "@src/a.ts" is behind it.
  const atEnd = findChipEdits(plain, plain.content.size - 1);
  assert.deepEqual(atEnd.map(edit => edit.text), ["@src/a.ts"]);
  const inside = findChipEdits(plain, 1 + "fix @src/".length);
  assert.deepEqual(inside.map(edit => edit.text), ["/rev"], "a caret inside a token keeps it as text");
  assert.deepEqual(findChipEdits(plain, null).map(edit => edit.text), ["@src/a.ts", "/rev"], "without a caret (blur) both convert");
  assert.deepEqual(atEnd[0], { from: 5, to: 14, kind: "file", text: "@src/a.ts" });
});

test("a token glued to a chip stays text so the characters read back the same", () => {
  const chip = schema.nodes.composerChip.create({ kind: "file", text: "@a.ts" });
  const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, [chip, schema.text("/b")]));
  assert.deepEqual(findChipEdits(doc, null), []);
  assert.equal(docToText(doc), "@a.ts/b");
  const spaced = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, [chip, schema.text(" /b")]));
  assert.deepEqual(findChipEdits(spaced, null).map(edit => edit.text), ["/b"]);
});

test("the @ and / list never opens while an input method composes or the reading is stale", () => {
  const open = { focused: true, unavailable: false, composing: false, current: true };
  assert.deepEqual(activeComposerTrigger(open, "fix @src", 8, 8), { kind: "file", query: "src", start: 4, end: 8 });
  assert.equal(activeComposerTrigger({ ...open, composing: true }, "fix @src", 8, 8), null);
  assert.equal(activeComposerTrigger({ ...open, focused: false }, "fix @src", 8, 8), null);
  assert.equal(activeComposerTrigger({ ...open, unavailable: true }, "fix @src", 8, 8), null);
  assert.equal(activeComposerTrigger({ ...open, current: false }, "fix @src", 8, 8), null);
  // Offsets count UTF-16 units, as the editor reports them: an emoji before the token is two.
  assert.deepEqual(activeComposerTrigger(open, "😀 /re", 6, 6), { kind: "skill", query: "re", start: 3, end: 6 });
  // A selection, a URL or an email never trigger.
  assert.equal(activeComposerTrigger(open, "/review", 0, 7), null);
  assert.equal(activeComposerTrigger(open, "me@example.com", 14, 14), null);
});
