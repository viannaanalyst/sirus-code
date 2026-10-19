import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReleaseNotes, releaseNotesCount } from "../src/lib/release-notes.ts";

test("release notes: headings start sections, bullets and plain lines are items, marks are dropped", () => {
  const sections = parseReleaseNotes("Intro line\n\n## New\n- **Usage** page\n* Project style\n\n### Fixes\n1. Tabs no longer cut\n`code` fix\n## Empty\n");
  assert.deepEqual(sections, [
    { title: null, items: ["Intro line"] },
    { title: "New", items: ["Usage page", "Project style"] },
    { title: "Fixes", items: ["Tabs no longer cut", "code fix"] },
  ]);
  assert.equal(releaseNotesCount(sections), 5);
  assert.deepEqual(parseReleaseNotes(null), []);
  assert.deepEqual(parseReleaseNotes("   \n"), []);
});
