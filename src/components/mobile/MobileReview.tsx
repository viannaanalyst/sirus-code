import { ChevronLeft } from "@/components/icons/phosphor";
import { ChangesPane } from "@/components/ChangesPane";
import { useTranslation } from "@/i18n/use-translation";
import { useAppStore } from "@/store/app-store";
import type { MobileNavigation } from "./MobileApp";

/** The session's changes as on the Mac: file tree, diff, staging, commit and push. */
export function MobileReview({ sessionId, navigation }: { sessionId: string; navigation: MobileNavigation }) {
  const t = useTranslation();
  const session = useAppStore((state) => state.sessions.find((item) => item.id === sessionId));

  return <div className="mobile-page mobile-review">
    <header className="mobile-bar">
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.back")} onClick={navigation.back}><ChevronLeft size={18} aria-hidden="true" /></button>
      <div className="mobile-bar-title">
        <h1>{t("mobile.review")}</h1>
        <p>{session?.title}</p>
      </div>
    </header>
    <div className="mobile-review-body">
      {session ? <ChangesPane key={`${session.id}:${session.worktree.path}`} sessionId={session.id} workspacePath={session.worktree.path} /> : null}
    </div>
  </div>;
}
