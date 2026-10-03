import { Pin } from "lucide-react";
import { useTranslation } from "@/i18n/use-translation";
import { useAppStore } from "@/store/app-store";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import type { Session } from "@/client/types";

export function PinnedMessages({ session }: { session: Session }) {
  const t = useTranslation();
  const jump = useAppStore((state) => state.jumpToMessage);
  const pinned = new Set(session.pinnedMessageIds ?? []);
  const messages = session.messages.filter((message) => pinned.has(message.id));
  return <div className="scroll-thin h-full overflow-y-auto px-3 py-3">
    <h2 className="mb-2 ui-section-title text-text-secondary">{t("Pinned messages")}</h2>
    {messages.length ? <div className="flex flex-col gap-1">{messages.map((message) => <InteractiveButton key={message.id} variant="ghost" className="h-auto min-h-8 items-start justify-start py-2 text-left" aria-label={t("Go to pinned message")} onClick={() => jump(session.id, message.id)}><Pin aria-hidden="true" size={14} className="mt-1 shrink-0 text-accent" /><span className="line-clamp-3 whitespace-pre-wrap break-words ui-control">{message.content.slice(0, 240)}</span></InteractiveButton>)}</div> : <p className="ui-control text-text-muted">{t("Pin an assistant response to find it here. Pins are bookmarks and do not change the AI’s context.")}</p>}
  </div>;
}
