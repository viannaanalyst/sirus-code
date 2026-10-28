import { ChevronRight, CornerUpLeft, Users } from "@/components/icons";
import type { Session } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { parentLink } from "@/lib/session-parent";
import { selectSessionsMeta, useAppStore } from "@/store/app-store";

/**
 * "Parent › this conversation" over a child session (ADR-111): delegated tasks,
 * sessions an agent started and team helpers link back to where they came from.
 */
export function ParentBreadcrumb({ session }: { session: Session }) {
  const t = useTranslation();
  const sessions = useAppStore(selectSessionsMeta);
  const link = parentLink(session, sessions);
  if (!link) return null;
  const Icon = link.kind === "team" ? Users : CornerUpLeft;
  const open = () => void useAppStore.getState().selectSession(link.sessionId);
  return <nav aria-label={t("parent.breadcrumb")} className="parent-breadcrumb mx-auto flex w-full max-w-[var(--chat-column-width)] min-w-0 items-center gap-1.5 px-3 pt-2 ui-caption text-text-muted">
    <Icon aria-hidden="true" size={13} className="shrink-0" />
    <span className="shrink-0">{t(`parent.${link.kind}`)}</span>
    <button type="button" onClick={open} title={link.title} aria-label={t("parent.open", { title: link.title })}
      className="min-w-0 max-w-[45%] truncate rounded-[5px] px-1 font-medium text-text-secondary transition-colors duration-[var(--motion-fast)] hover:bg-background-3 hover:text-text-primary">{link.title}</button>
    <ChevronRight aria-hidden="true" size={11} className="shrink-0" />
    <span className="min-w-0 truncate" aria-current="page">{session.title}</span>
  </nav>;
}
