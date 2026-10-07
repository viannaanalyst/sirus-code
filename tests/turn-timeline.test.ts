import test from "node:test";
import assert from "node:assert/strict";
import type { ActivityItem } from "../src/client/types.ts";
import { foldBoundary, groupSentence, stepCategory, stepDetail, stepSentence, timelineParts } from "../src/lib/turn-timeline.ts";
import { translate } from "../src/i18n/index.ts";

const row = (id: string, kind: ActivityItem["kind"], detail: string, offset?: number, state: ActivityItem["state"] = "completed", label = ""): ActivityItem => ({ id, kind, label, state, model: null, detail, offset });
const pt = (key: string, params?: Record<string, string | number>) => translate("pt-BR", key, params);

test("text and work interleave in the order they happened; back-to-back work is one group", () => {
  const content = "Vou ler o README.\n\nAgora rodo os testes.\n\nPronto.";
  const parts = timelineParts(content, [row("s", "skill", "graphify", 0), row("a", "read", "README.md", 18), row("b", "read", "docs/a.md", 19), row("c", "command", "npm test", 41)]);
  assert.deepEqual(parts.map((part) => part.kind === "work" ? `work:${part.items.map((item) => item.id).join("")}` : part.kind === "text" ? `text:${content.slice(part.start, part.end).trim()}` : "steer"), [
    "work:s", "text:Vou ler o README.", "work:ab", "text:Agora rodo os testes.", "work:c", "text:Pronto.",
  ]);
  assert.equal(foldBoundary(parts), 5, "a finished turn folds everything before its final answer");
  // Rows recorded before offsets existed sit at the start.
  assert.deepEqual(timelineParts("Olá", [row("x", "edit", "a.ts")]).map((part) => part.kind), ["work", "text"]);
  assert.equal(foldBoundary(timelineParts("", [row("x", "edit", "a.ts")])), 1);
});

test("steps read as T3 sentences in Portuguese", () => {
  assert.equal(stepCategory(row("a", "read", "src/app.ts")), "read");
  assert.equal(stepCategory(row("a", "read", "TODO|FIXME")), "search");
  assert.equal(stepCategory(row("a", "read", "/Users/me/Library/Application Support/wt/README.md")), "read");
  assert.equal(stepCategory(row("a", "read", "**/*.ts")), "search");
  assert.equal(stepCategory(row("a", "read", "como funciona")), "search");
  assert.equal(stepCategory(row("a", "read", "sirus code", undefined, "completed", "Web search")), "web");
  assert.equal(stepDetail("/repo/src/app.ts", "/repo"), "src/app.ts");
  assert.equal(stepSentence(row("a", "read", "/repo/src/app.ts"), pt, "/repo"), "Leu src/app.ts");
  assert.equal(stepSentence(row("a", "command", "npm test", 0, "running"), pt), "Rodando npm test…");
  assert.equal(stepSentence(row("a", "edit", ""), pt), "Alterou arquivos");
  const group = [row("s", "skill", "graphify"), row("e1", "edit", "a.ts"), row("e2", "edit", "a.ts"), row("e3", "edit", "b.ts"), row("c", "command", "npm test"), row("r", "read", "c.ts")];
  assert.equal(groupSentence(group, pt), "Usou 1 skill, alterou 2 arquivos e realizou mais 2 ações");
  assert.equal(groupSentence([row("r1", "read", "a.ts"), row("r2", "read", "b.ts"), row("q", "read", "foo bar")], pt), "Leu 2 arquivos e buscou no código 1 vez");
});
