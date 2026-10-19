import { createContext, useContext, useMemo, useState } from "react";
import type { ActivityItem, Message } from "@/client/types";
import { client } from "@/client";
import { useTranslation } from "@/i18n/use-translation";
import { maskSecrets } from "@/lib/redact";
import { formatOutputSize, hasStoredOutput, toolOutputKey, toolOutputs } from "@/lib/tool-output";

/** The message whose activity is shown, so a row can fetch its output stored apart (ADR-147). */
export const ActivityMessage = createContext<Pick<Message, "id" | "sessionId"> | null>(null);

type Load = { state: "idle" } | { state: "loading" } | { state: "failed"; error: string } | { state: "done"; text: string };

/**
 * An opened command row's output. A row whose output is stored apart shows its last lines and
 * fetches the rest on request (cached per row); a running row's output is whole, as before.
 */
export function ToolOutputBlock({ id, item, preview }: { id: string; item: ActivityItem; preview: string }) {
  const t = useTranslation();
  const message = useContext(ActivityMessage);
  const stored = hasStoredOutput(item) && message !== null;
  const key = message ? toolOutputKey(message.sessionId, message.id, item.id) : "";
  const [load, setLoad] = useState<Load>(() => {
    const text = stored ? toolOutputs.get(key) : undefined;
    return text === undefined ? { state: "idle" } : { state: "done", text };
  });
  const full = useMemo(() => load.state === "done" ? maskSecrets(load.text.trimEnd()) : null, [load]);
  const fetchFull = () => {
    if (!message || load.state === "loading") return;
    setLoad({ state: "loading" });
    toolOutputs.load(key, () => client.toolOutput(message.sessionId, message.id, item.id))
      .then((text) => setLoad({ state: "done", text }))
      .catch((error: unknown) => setLoad({ state: "failed", error: error instanceof Error ? error.message : String(error) }));
  };
  if (!stored || full !== null) return <pre id={id} className="tl-output">{full ?? preview}</pre>;
  const size = formatOutputSize(item.outputBytes ?? 0);
  return <div id={id} className="tl-output tl-output-stored" aria-busy={load.state === "loading" || undefined}>
    <button type="button" className="tl-output-more ui-caption" disabled={load.state === "loading"} onClick={fetchFull}>
      {load.state === "loading" ? t("timeline.output.loading") : load.state === "failed" ? t("timeline.output.retry") : t("timeline.output.full", { size })}
    </button>
    {load.state === "failed" ? <p className="tl-output-error ui-caption" role="alert" title={load.error}>{t("timeline.output.failed")}</p> : null}
    <pre>{preview}</pre>
  </div>;
}
