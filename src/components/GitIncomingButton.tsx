import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { client } from "@/client";
import type { GitIncoming } from "@/client/types";
import { Check, CloudArrowDown, LoaderCircle } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { commitAge, incomingButton, INCOMING_REFRESH_MS, PULLED_FOR_MS, pullFeedback, turnSettled, type PullFeedback } from "@/lib/git-incoming";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { Tooltip } from "@/primitives/Tooltip";
import { useAppStore } from "@/store/app-store";
import "@/styles/git-incoming.css";

const ACTIVE = new Set(["starting", "running", "waiting"]);

type Failure = PullFeedback | { kind: "error"; message: string };

/**
 * The header's Pull button (ADR-148): shown when the selected conversation's workspace branch
 * is behind its upstream with nothing of its own (fast-forward possible), muted when both sides
 * have commits. Its popover lists the incoming commits and pulls with `git pull --ff-only`.
 */
export function GitIncomingButton() {
  const t = useTranslation();
  const sessionId = useAppStore((state) => state.selectedSessionId);
  const status = useAppStore((state) => state.sessions.find((session) => session.id === sessionId)?.status);
  const folder = useAppStore((state) => state.sessions.find((session) => session.id === sessionId)?.worktree.path);
  const [incoming, setIncoming] = useState<{ sessionId: string; value: GitIncoming | null } | null>(null);
  const [open, setOpen] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState<{ branch: string; upstream: string } | null>(null);
  const request = useRef(0);

  const refresh = useCallback(() => {
    if (!sessionId) return;
    const sequence = ++request.current;
    void client.gitIncoming(sessionId).then(
      (value) => { if (sequence === request.current) setIncoming({ sessionId, value }); },
      () => { if (sequence === request.current) setIncoming({ sessionId, value: null }); },
    );
  }, [sessionId]);

  // A new workspace: forget the last one's answer and ask again.
  useEffect(() => {
    setIncoming(null);
    setFailure(null);
    setDone(null);
    setOpen(false);
    refresh();
  }, [refresh, folder]);

  // Back to the window, and every 5 minutes while it is visible. Native fetches at most every 15 s.
  useEffect(() => {
    const onReturn = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, INCOMING_REFRESH_MS);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
      window.clearInterval(timer);
    };
  }, [refresh]);

  // A settled turn may have committed, pushed or pulled.
  const lastStatus = useRef(status);
  useEffect(() => {
    if (turnSettled(lastStatus.current, status)) refresh();
    lastStatus.current = status;
  }, [status, refresh]);

  // The green check stays a moment, then the button leaves.
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => { setDone(null); setOpen(false); }, PULLED_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [done]);

  const current = incoming && incoming.sessionId === sessionId ? incoming.value : null;
  const view = incomingButton(current);
  const working = !!status && ACTIVE.has(status);

  const pull = async () => {
    if (!sessionId || !current || pulling) return;
    setPulling(true);
    setFailure(null);
    try {
      const outcome = await client.gitPullFastForward(sessionId);
      const feedback = pullFeedback(outcome);
      if (feedback.kind === "pulled") {
        setDone({ branch: current.branch, upstream: current.upstream });
        setIncoming({ sessionId, value: outcome.status === "pulled" ? outcome.incoming : null });
        void useAppStore.getState().refreshGitStatus();
      } else {
        // The popover keeps the explanation; the button follows the new state once it closes.
        setFailure(feedback);
      }
    } catch (reason) {
      setFailure({ kind: "error", message: t(formatUnknownError(reason)) });
    } finally {
      setPulling(false);
    }
  };

  const shown = done ? "done" : view.kind;
  const motionProps = { initial: { opacity: 0, scale: 0.9 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.9 } };
  let label = "";
  if (done) label = t("gitIncoming.done", done);
  else if (view.kind === "diverged") label = t("gitIncoming.diverged", { branch: view.branch, upstream: view.upstream, ahead: view.ahead, behind: view.behind });
  else if (view.kind === "pull") label = t(view.count === 1 ? "gitIncoming.tooltip.one" : "gitIncoming.tooltip", { count: view.count, upstream: view.upstream });
  const more = current ? current.behind - current.commits.length : 0;

  return <AnimatePresence initial={false}>
    {shown === "hidden" ? null : <motion.span key="git-incoming" className="inline-flex" {...motionProps}>
      {shown === "diverged" ? <Tooltip label={label}>
        <button type="button" className="git-incoming-button" data-tone="muted" aria-disabled="true" aria-label={label}><CloudArrowDown size={14} /></button>
      </Tooltip> : <Popover open={open} onOpenChange={(next) => {
        setOpen(next);
        if (next) return;
        if (failure) { setFailure(null); refresh(); }
      }}>
        <Tooltip label={label}>
          <PopoverTrigger asChild>
            <button type="button" className="git-incoming-button" data-tone={done ? "done" : "info"} aria-label={label}>
              {done ? <Check size={14} weight="bold" /> : pulling ? <LoaderCircle size={14} className="animate-spin" /> : <CloudArrowDown size={14} />}
            </button>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent side="bottom" align="end" sideOffset={8} className="w-[360px] p-0">
          {done ? <div className="git-incoming-panel">
            <p className="git-incoming-done" role="status"><Check size={14} weight="bold" aria-hidden="true" />{label}</p>
          </div> : view.kind === "pull" && current ? <div className="git-incoming-panel">
            <p className="git-incoming-title">{t(view.count === 1 ? "gitIncoming.title.one" : "gitIncoming.title", { count: view.count, upstream: view.upstream })}</p>
            <p className="git-incoming-sub">{t("gitIncoming.subtitle", { branch: view.branch })}</p>
            <ul className="git-incoming-commits scroll-thin" aria-label={t("gitIncoming.commits")}>
              {current.commits.map((commit) => {
                const age = commitAge(commit);
                const at = new Date(commit.time * 1000);
                return <li key={commit.sha} className="git-incoming-commit">
                  <span className="git-incoming-sha">{commit.sha}</span>
                  <span className="min-w-0">
                    <span className="git-incoming-subject" title={commit.subject}>{commit.subject}</span>
                    <span className="git-incoming-meta">{commit.author} · <time dateTime={at.toISOString()} title={at.toLocaleString()}>{age === "now" ? t("gitIncoming.now") : age}</time></span>
                  </span>
                </li>;
              })}
              {more > 0 ? <li className="git-incoming-more">{t("gitIncoming.more", { count: more })}</li> : null}
            </ul>
            {failure ? <PullFailure failure={failure} branch={view.branch} upstream={view.upstream} /> : null}
            {working && !pulling ? <p className="git-incoming-sub git-incoming-wait">{t("A conversation is working in this folder. Pull when it finishes.")}</p> : null}
            <InteractiveButton variant="primary" className="git-incoming-action" disabled={pulling || working} onClick={() => void pull()}>
              {pulling ? <><LoaderCircle size={14} className="animate-spin" aria-hidden="true" />{t("gitIncoming.pulling")}</> : t("gitIncoming.pullNow")}
            </InteractiveButton>
          </div> : null}
        </PopoverContent>
      </Popover>}
    </motion.span>}
  </AnimatePresence>;
}

function PullFailure({ failure, branch, upstream }: { failure: Failure; branch: string; upstream: string }) {
  const t = useTranslation();
  if (failure.kind === "pulled") return null;
  return <div role="alert" className="git-incoming-error">
    {failure.kind === "blocked" ? <>
      <p>{t("gitIncoming.blocked")}</p>
      <ul className="git-incoming-files scroll-thin">{failure.files.map((file) => <li key={file}>{file}</li>)}</ul>
      <p>{t("gitIncoming.blockedHelp")}</p>
    </> : failure.kind === "diverged" ? <p>{t("gitIncoming.diverged", { branch, upstream, ahead: failure.ahead, behind: failure.behind })}</p>
      : <p>{failure.message}</p>}
  </div>;
}
