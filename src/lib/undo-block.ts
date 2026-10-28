import type { UndoBlock } from "@/client/types";

type Translate = (key: string, params?: Record<string, string | number>) => string;

const short = (id: string) => id.slice(0, 7);

/** "a.ts" or "a.ts and 2 more", for a refusal message (ADR-187). */
export function fileList(files: string[], t: Translate): string {
  if (files.length === 0) return t("undo.block.someFiles");
  if (files.length === 1) return files[0];
  return t("undo.block.andMore", { first: files[0], count: files.length - 1 });
}

/** The person-facing reason undo is refused, in the current language (ADR-187). */
export function undoBlockText(block: UndoBlock, t: Translate): string {
  switch (block.kind) {
    case "headMoved":
      return t("undo.block.headMoved", { was: short(block.was), now: short(block.now) });
    case "otherSession":
      return block.running
        ? t("undo.block.running", { title: block.title })
        : t("undo.block.unkept", { title: block.title, files: fileList(block.files, t) });
    case "changedAgain":
      return t(block.laterTurn ? "undo.block.laterTurn" : "undo.block.edited", { files: fileList(block.files, t) });
  }
}

/** The session to open to resolve a refusal, when another session caused it. */
export function undoBlockSession(block: UndoBlock | null): string | null {
  return block?.kind === "otherSession" ? block.sessionId : null;
}
