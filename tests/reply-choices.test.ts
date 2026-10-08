import test from "node:test";
import assert from "node:assert/strict";
import { replyChoices } from "../src/lib/reply-choices.ts";

test("a reply ending in a question with short options offers them as choices", () => {
  const reply = "Vou conferir o fluxo.\n\nComo aplicar ICP-Brasil? A skill pede validar o desenho antes.\n\n- Escolha em cada envio (Recomendado)\n- **Padrão** permanente";
  assert.deepEqual(replyChoices(reply), { question: "Como aplicar ICP-Brasil?", options: ["Escolha em cada envio (Recomendado)", "Padrão permanente"] });
  assert.equal(replyChoices("Opções:\n1. Rápido\n2. Completo\n\nQual você prefere?"), null, "a question after the list is prose");
  assert.equal(replyChoices("Por exemplo, trocar:\n\n- Financeiro: R$ 600 → Administrativo\n- Marketing continua igual.\n\nNa página, você escolheria o centro. É essa troca que você quer fazer?"), null, "examples before a question");
});

test("ordinary lists are not questions", () => {
  assert.equal(replyChoices("O que encontrei:\n- A\n- B"), null, "no question");
  assert.equal(replyChoices("Qual? \n- só uma"), null, "one option");
  assert.equal(replyChoices("Pergunta?\n\n- A\n- B\n\nDepois rodei os testes."), null, "the list is not at the end");
  assert.equal(replyChoices(`Qual?\n- ${"x".repeat(200)}\n- B`), null, "options must be short");
});
