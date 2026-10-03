import type { Session } from "@/client/types";
import { MessageTimestamp } from "@/components/MessageActions";
import { useTranslation } from "@/i18n/use-translation";

export function CliDiagnostics({ session }: { session: Session }) {
  const t = useTranslation();
  const messages = session.messages.filter((message) => message.role === "system" && message.content.trim());
  return <div className="scroll-thin h-full overflow-y-auto px-3 py-3">
    <h2 className="ui-section-title text-text-secondary">{t("CLI diagnostics")}</h2>
    {messages.length ? messages.map((message) => <section key={message.id} className="mt-3 border-t border-border-subtle pt-2">
      <MessageTimestamp createdAt={message.createdAt} className="text-text-muted" />
      <pre className="selectable scroll-thin mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono ui-description text-text-muted">{message.content}</pre>
    </section>) : <p className="mt-3 ui-control text-text-muted">{t("No CLI diagnostics in this session.")}</p>}
  </div>;
}
