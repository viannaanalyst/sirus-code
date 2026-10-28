import { memo, useId, useMemo, useState } from "react";
import { useClock } from "@/lib/shared-clock";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, CircleHelp, Square, Users, X, Zap } from "@/components/icons";
import type { ActivityItem, AgentProviderId } from "@/client/types";
import { ModelIcon } from "@/components/ModelIcon";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { formatActivityDuration } from "@/lib/agent-activity";
import { memberElapsed, teamHeadline, teamPhases, teamProgress, type MemberStatus, type TeamMember } from "@/lib/subagent-team";
import { useArcReducedMotion } from "@/components/arc/lib/use-arc-motion";
import { motionTokens } from "@/lib/motion";
import { useAppStore } from "@/store/app-store";

const statusIcons: Record<Exclude<MemberStatus, "running">, typeof Check> = { completed: Check, failed: X, stopped: Square, unknown: CircleHelp };

/** Three hopping dots while it runs (the header tabs' running mark); settled states keep a glyph. */
export function MemberStatusMark({ status }: { status: MemberStatus }) {
  const t = useTranslation();
  if (status === "running") return <span className="team-dots" role="img" aria-label={t("team.state.running")}><i /><i /><i /></span>;
  const Icon = statusIcons[status];
  return <span className="team-status" data-status={status} role="img" aria-label={t(`team.state.${status}`)}><Icon size={status === "stopped" ? 9 : 11} aria-hidden="true" /></span>;
}

/** The provider's mark, or the model's when the subagent named one. */
export function MemberMark({ provider, model }: { provider: AgentProviderId; model: string | null }) {
  return <span className="team-member-mark" aria-hidden="true">{model ? <ModelIcon modelId={model} provider={provider} size={14} /> : <ProviderIcon id={provider} size={14} className="bg-transparent" />}</span>;
}

/** A clock that ticks once a second while `running`, resting while the window is hidden. */
export function useTick(running: boolean): number {
  return useClock(1000, running);
}

/**
 * The team card at the top of a turn that started two subagents or more (ADR-146): the turn's
 * headline, its subagents grouped into the batches they were launched in, each with its mark,
 * live state, elapsed time and tools used. A row opens that subagent's live view in the dock.
 * It re-renders with its own turn's activity only, and ticks on its own clock.
 */
export const SubagentTeam = memo(function SubagentTeam({ items, provider, sessionId, messageId, prompt, replyHead }: {
  items: readonly ActivityItem[];
  provider: AgentProviderId;
  sessionId: string;
  messageId: string;
  prompt: string;
  /** The reply up to the first launch, where a plan's title would be. */
  replyHead: string;
}) {
  const t = useTranslation();
  const reduced = useArcReducedMotion();
  const bodyId = useId();
  const phases = useMemo(() => teamPhases(items), [items]);
  const progress = teamProgress(phases);
  const headline = useMemo(() => teamHeadline(prompt, replyHead, undefined), [prompt, replyHead]);
  const [open, setOpen] = useState(true);
  const now = useTick(progress.running > 0);
  const openView = useAppStore((state) => state.openSubagentView);
  const summary = [
    t("team.progress", { done: progress.done, total: progress.total }),
    progress.running ? t("team.runningCount", { count: progress.running }) : null,
    progress.failed ? t(progress.failed === 1 ? "team.failedCount.one" : "team.failedCount", { count: progress.failed }) : null,
  ].filter(Boolean).join(" · ");
  const numbers = new Map(phases.flatMap((phase) => phase.members).map((member, index) => [member.id, index + 1] as const));
  return <section className="team-card" data-running={progress.running > 0 || undefined} aria-label={t("team.label")}>
    <button type="button" className="team-card-head" aria-expanded={open} aria-controls={bodyId} title={t(open ? "team.collapse" : "team.expand")} onClick={() => setOpen((value) => !value)}>
      <span className="team-card-icon" aria-hidden="true"><Users size={14} /></span>
      <span className="team-card-title">{headline || t("team.count", { count: progress.total })}</span>
      <span className="team-card-summary">{summary}</span>
      <ChevronDown size={12} className={open ? "activity-chevron expanded" : "activity-chevron"} aria-hidden="true" />
    </button>
    <AnimatePresence initial={false}>
      {open ? <motion.div key="body" id={bodyId} className="team-card-body"
        initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }} animate={reduced ? { opacity: 1 } : { opacity: 1, height: "auto" }} exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
        transition={{ duration: motionTokens.normal, ease: motionTokens.ease }}>
        {phases.map((phase) => <div key={phase.index} className="team-phase">
          {phases.length > 1 ? <div className="team-phase-title">{t("team.phase", { number: phase.index })}</div> : null}
          <ul className="team-members">
            {phase.members.map((member) => {
              const name = member.label || t("team.untitled", { number: numbers.get(member.id) ?? 0 });
              return <li key={member.id}>
                <MemberRow member={member} name={name} provider={provider} now={now} onOpen={() => openView(sessionId, messageId, { id: member.id, key: member.key, label: name })} />
              </li>;
            })}
          </ul>
        </div>)}
      </motion.div> : null}
    </AnimatePresence>
  </section>;
});

function MemberRow({ member, name, provider, now, onOpen }: { member: TeamMember; name: string; provider: AgentProviderId; now: number; onOpen: () => void }) {
  const t = useTranslation();
  const elapsed = memberElapsed(member, now);
  const tools = member.workflow ? t("workflow.agents", { done: member.workflow.done, total: member.workflow.total })
    : member.tools ? t(member.tools === 1 ? "team.tools.one" : "team.tools", { count: member.tools }) : null;
  return <button type="button" className="team-member" data-status={member.status} onClick={onOpen} aria-label={t("team.open", { name })}>
    <MemberMark provider={provider} model={member.model} />
    <span className="team-member-name" title={name}>{name}</span>
    {member.background ? <Zap size={11} className="team-member-background" aria-label={t("team.background")} /> : null}
    <span className="team-member-meta">
      {tools ? <span>{tools}</span> : null}
      {elapsed !== null ? <span className="activity-duration">{formatActivityDuration(elapsed)}</span> : null}
    </span>
    <MemberStatusMark status={member.status} />
  </button>;
}
