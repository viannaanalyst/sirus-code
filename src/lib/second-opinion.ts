import type { Message, Session } from "@/client/types";

const REQUEST_LIMIT = 600;
const ANSWER_LIMIT = 1600;
const FILE_LIMIT = 40;

const clip = (text: string, limit: number) => {
  const clean = text.trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit).trimEnd()}\n[…]`;
};

/** The user request that led to `messageId`, the reply itself and the files its turn changed. */
export function secondOpinionTurn(session: Session, messageId: string) {
  const index = session.messages.findIndex((message) => message.id === messageId);
  const answer: Message | undefined = session.messages[index];
  const request = index > 0 ? session.messages.slice(0, index).reverse().find((message) => message.role === "user") : undefined;
  const files = [...new Set((answer?.activity?.review?.files ?? []).map((file) => file.path))].slice(0, FILE_LIMIT);
  return { request: request?.content ?? "", answer: answer?.content ?? "", files };
}

/**
 * Review prompt for another agent working in the same files (ADR-056). It
 * reviews and reports; changes wait for the person's next request.
 */
export function secondOpinionPrompt(turn: ReturnType<typeof secondOpinionTurn>, from: string, portuguese: boolean) {
  const files = turn.files.length ? turn.files.map((path) => `- ${path}`).join("\n") : portuguese ? "(nenhum arquivo registrado neste turno)" : "(no files recorded on this turn)";
  return portuguese
    ? [
        `Dê uma segunda opinião sobre o trabalho que ${from} acabou de fazer nesta mesma pasta. Os arquivos já estão no disco.`,
        "Revise o que está errado, o que faltou e o que você faria diferente. Leia os arquivos listados antes de opinar. Não altere nada agora: liste os problemas do mais grave ao menos grave, com arquivo e linha quando possível, e diga como corrigir. Se estiver tudo certo, diga isso.",
        `## Pedido do usuário\n${clip(turn.request, REQUEST_LIMIT) || "(sem pedido neste turno)"}`,
        `## O que ${from} respondeu\n${clip(turn.answer, ANSWER_LIMIT) || "(sem resumo escrito — inspecione os arquivos)"}`,
        `## Arquivos alterados\n${files}`,
      ].join("\n\n")
    : [
        `Give a second opinion on the work ${from} just finished in this same working copy. The files are already on disk.`,
        "Review what is wrong, what is missing and what you would have done differently. Read the listed files before judging. Do not change anything yet: list the problems from most to least severe, with file and line where possible, and say how to fix them. If it is all fine, say so.",
        `## User request\n${clip(turn.request, REQUEST_LIMIT) || "(no request on this turn)"}`,
        `## What ${from} answered\n${clip(turn.answer, ANSWER_LIMIT) || "(no written summary — inspect the files)"}`,
        `## Files changed\n${files}`,
      ].join("\n\n");
}
