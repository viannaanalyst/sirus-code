import { ChevronLeft } from "@/components/icons/phosphor";
import { ChangesPane } from "@/components/ChangesPane";
import { useState } from "react";
import { useTranslation } from "@/i18n/use-translation";
import { appendDiffComment } from "@/lib/diff-comment";
import { useAppStore } from "@/store/app-store";
import type { MobileNavigation } from "./MobileApp";

/** The session's changes as on the Mac: file tree, diff, staging, commit and push. */
export function MobileReview({ sessionId, navigation }: { sessionId: string; navigation: MobileNavigation }) {
  const t = useTranslation();
  const session = useAppStore((state) => state.sessions.find((item) => item.id === sessionId));
  const [noted, setNoted] = useState(0);

  return <div className="mobile-page mobile-review">
    <header className="mobile-bar">
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.back")} onClick={navigation.back}><ChevronLeft size={18} aria-hidden="true" /></button>
      <div className="mobile-bar-title">
        <h1>{t("mobile.review")}</h1>
        <p>{session?.title}</p>
      </div>
    </header>
    <div className="mobile-review-body">
      {session ? <ChangesPane key={`${session.id}:${session.worktree.path}`} sessionId={session.id} workspacePath={session.worktree.path} onComment={(selection) => {
        // The comment joins the conversation's draft, ready to send to the agent (ADR-086).
        const store = useAppStore.getState();
        const key = `session:${session.id}`;
        const next = appendDiffComment(store.composerDrafts[key] ?? "", selection.path, selection.diff, selection.from, selection.to, selection.comment);
        if (next === null) return false;
        store.setComposerDraft(key, next);
        setNoted((count) => count + 1);
        return true;
      }} /> : null}
    </div>
    {noted ? <div className="mobile-review-note" role="status">
      <span>{t(noted === 1 ? "mobile.commentAdded" : "mobile.commentsAdded", { count: noted })}</span>
      <button type="button" onClick={navigation.back}>{t("mobile.backToChat")}</button>
    </div> : null}
  </div>;
}
