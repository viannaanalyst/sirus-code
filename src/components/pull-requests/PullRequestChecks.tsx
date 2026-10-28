import { useCallback, useMemo, useState } from "react";
import { ChevronRight, CircleAlert, CircleCheck, CircleDashed, CircleMinus, ExternalLink, LoaderCircle, Sparkles, X } from "@/components/icons";
import { client } from "@/client";
import type { GithubDetail, GithubFailedCheck } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { cascadeIndex, useCascade } from "@/lib/cascade";
import { cn } from "@/lib/cn";
import { formatUnknownError } from "@/lib/format-error";
import { checkDuration, failingNames, failureFor, formatDuration, sortChecks, type FixPhase } from "@/lib/pr-checks";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import "@/styles/pull-checks.css";

export type Failures = { checks: GithubFailedCheck[]; truncated: boolean };
type FailureState = { key: string; value: Failures | { error: string } | "loading" };

const CHECK_ICON = { passed: CircleCheck, failed: CircleAlert, pending: CircleDashed, skipped: CircleMinus, unknown: CircleDashed } as const;

/** The Checks tab (ADR-050): every check of the latest commit, log excerpts for failures and Fix with AI. */
export function PullRequestChecks({ detail, canFix, fixing, progress, onFix, onDismissProgress }: {
  detail: GithubDetail;
  canFix: boolean;
  fixing: boolean;
  progress: FixPhase | null;
  onFix: (selected: string[], failures: Failures | null) => void;
  onDismissProgress: () => void;
}) {
  const t = useTranslation();
  const checks = useMemo(() => sortChecks(detail.checks), [detail.checks]);
  const failing = useMemo(() => failingNames(detail.checks), [detail.checks]);
  const passed = detail.checks.filter((check) => check.status === "passed").length;
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  // The failures lookup (bounded logs, ADR-050) runs once per head, on the first log or fix.
  const failureKey = `${detail.item.repository}#${detail.item.number}@${detail.headOid ?? ""}`;
  const [failureState, setFailureState] = useState<FailureState | null>(null);
  const failures = failureState?.key === failureKey ? failureState.value : null;
  const loadFailures = useCallback(async (): Promise<Failures | null> => {
    if (failures && failures !== "loading") return "error" in failures ? null : failures;
    setFailureState({ key: failureKey, value: "loading" });
    try {
      const response = await client.pullRequestAction({ type: "failures", repository: detail.item.repository, number: detail.item.number });
      const value = response.type === "failures" ? { checks: response.checks, truncated: response.truncated } : { error: "pulls.checks.logFailed" };
      setFailureState({ key: failureKey, value });
      return "error" in value ? null : value;
    } catch (reason) {
      setFailureState({ key: failureKey, value: { error: formatUnknownError(reason) } });
      return null;
    }
  }, [failures, failureKey, detail.item.repository, detail.item.number]);

  const toggle = (index: number, failed: boolean) => {
    const next = new Set(open);
    if (next.has(index)) next.delete(index);
    else { next.add(index); if (failed && !failures) void loadFailures(); }
    setOpen(next);
  };

  return <div className="flex flex-col gap-3">
    {progress ? <FixProgress progress={progress} onDismiss={onDismissProgress} /> : null}
    <div className="flex items-center justify-between gap-2">
      <h3 className="ui-section-title text-text-muted">{t("pulls.checksTitle", { passed, total: detail.checks.length })}</h3>
      {canFix && failing.length ? <FixPicker names={failing} busy={fixing || failures === "loading"} onConfirm={async (selected) => onFix(selected, await loadFailures())} /> : null}
    </div>
    <div className="pull-checks" role="list">
      {checks.map((check, index) => {
        const Icon = CHECK_ICON[check.status];
        const failed = check.status === "failed";
        const duration = checkDuration(check);
        const expanded = open.has(index);
        return <div key={`${check.name}:${index}`} role="listitem" className="pull-check">
          <div className="pull-check-row ui-control">
            {failed
              ? <button type="button" className="pull-check-toggle" aria-expanded={expanded} aria-label={t("pulls.checks.showLog", { name: check.name })} onClick={() => toggle(index, failed)}>
                <ChevronRight size={12} className="pull-check-caret" aria-hidden="true" />
              </button>
              : <span className="pull-check-toggle" aria-hidden="true" />}
            <Icon size={14} aria-label={t(`pulls.checks.status.${check.status}`)} className={cn("shrink-0", check.status === "passed" && "pulls-open", failed && "pulls-closed", !failed && check.status !== "passed" && "text-text-muted")} />
            <span className="min-w-0 flex-1 truncate" title={check.name}>{check.name}</span>
            {duration !== null ? <span className="shrink-0 font-mono ui-caption text-text-muted">{formatDuration(duration)}</span> : null}
            {check.url ? <button type="button" className="pull-check-link" aria-label={t("pulls.openCheck", { name: check.name })} onClick={() => void client.openExternalUrl(check.url!).catch(() => undefined)}><ExternalLink size={12} /></button> : null}
          </div>
          {failed && expanded ? <CheckLog failures={failures} check={check} /> : null}
        </div>;
      })}
    </div>
  </div>;
}

function CheckLog({ failures, check }: { failures: FailureState["value"] | null; check: GithubDetail["checks"][number] }) {
  const t = useTranslation();
  if (!failures || failures === "loading") return <p role="status" className="pull-check-detail ui-caption text-text-muted"><LoaderCircle size={12} className="animate-spin" aria-hidden="true" />{t("pulls.checks.readingLog")}</p>;
  if ("error" in failures) return <p role="alert" className="pull-check-detail ui-caption text-danger">{t(failures.error)}</p>;
  const failure = failureFor(failures.checks, check);
  if (!failure || (!failure.log && !failure.annotations.length && !failure.summary)) return <p className="pull-check-detail ui-caption text-text-muted">{t("pulls.checks.noLog")}</p>;
  return <div className="pull-check-detail flex-col items-stretch">
    {failure.summary ? <p className="whitespace-pre-wrap ui-caption text-text-secondary selectable">{failure.summary}</p> : null}
    {failure.annotations.length ? <div>
      <p className="ui-caption text-text-muted">{t("pulls.checks.annotations")}</p>
      <ul className="font-mono ui-caption text-text-secondary selectable">{failure.annotations.map((note, index) => <li key={index} className="[overflow-wrap:anywhere]">{note}</li>)}</ul>
    </div> : null}
    {failure.log ? <pre className="pull-check-log scroll-thin selectable" aria-label={t("pulls.checks.log")}>{failure.log}</pre> : null}
  </div>;
}

/** Pick which failing checks go into the fix draft; every one is selected at first. */
function FixPicker({ names, busy, onConfirm }: { names: string[]; busy: boolean; onConfirm: (selected: string[]) => Promise<void> }) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const cascade = useCascade(open);
  const selected = names.filter((name) => !excluded.has(name));
  const change = (value: boolean) => { setOpen(value); if (value) setExcluded(new Set()); };
  return <Popover open={open} onOpenChange={change}>
    <PopoverTrigger asChild>
      <button type="button" className="pulls-fix-checks ui-caption" disabled={busy}>{busy ? <LoaderCircle size={12} className="animate-spin" /> : <Sparkles size={12} />}{t(busy ? "pulls.fixingChecks" : "pulls.checks.fixWithAi")}</button>
    </PopoverTrigger>
    <PopoverContent align="end" side="bottom" sideOffset={6} className="floating-material pull-fix-picker" data-cascade={cascade ? "" : undefined} aria-label={t("pulls.checks.pickTitle")}>
      <div className="flex items-center justify-between gap-2 px-2 pt-1" data-cascade-item="" style={cascadeIndex(0)}>
        <p className="ui-control font-medium text-text-primary">{t("pulls.checks.pickTitle")}</p>
        <button type="button" className="ui-caption text-text-muted hover:text-text-primary" onClick={() => setExcluded(selected.length ? new Set(names) : new Set())}>{t(selected.length ? "pulls.checks.selectNone" : "pulls.checks.selectAll")}</button>
      </div>
      <div className="pull-fix-list scroll-thin">
        {names.map((name, index) => <label key={name} className="pull-fix-option ui-control" data-cascade-item="" style={cascadeIndex(index + 1)}>
          <input type="checkbox" checked={!excluded.has(name)} onChange={(event) => { const next = new Set(excluded); if (event.target.checked) next.delete(name); else next.add(name); setExcluded(next); }} />
          <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
        </label>)}
      </div>
      <p className="px-2 ui-caption text-text-muted">{t("pulls.checks.pickHint")}</p>
      <div className="flex justify-end p-1">
        <InteractiveButton variant="primary" glow={false} disabled={!selected.length || busy} onClick={() => { setOpen(false); void onConfirm(selected); }}><Sparkles size={14} />{t("pulls.checks.draftFix", { count: selected.length })}</InteractiveButton>
      </div>
    </PopoverContent>
  </Popover>;
}

function FixProgress({ progress, onDismiss }: { progress: FixPhase; onDismiss: () => void }) {
  const t = useTranslation();
  const label = progress.phase === "fixing"
    ? progress.source === "autoFix" ? t("pulls.fix.fixingAuto", { count: progress.attempts }) : t("pulls.fix.fixingManual")
    : t(`pulls.fix.${progress.phase}`);
  const done = progress.phase === "passed" || progress.phase === "failing";
  const Icon = progress.phase === "passed" ? CircleCheck : progress.phase === "failing" || progress.phase === "paused" ? CircleAlert : LoaderCircle;
  return <div role="status" className="pull-fix-progress ui-control" data-phase={progress.phase}>
    <Icon size={14} className={cn("shrink-0", !done && progress.phase !== "paused" && "animate-spin")} aria-hidden="true" />
    <span className="min-w-0 flex-1">{label}</span>
    {progress.phase === "waiting" || (progress.phase === "fixing" && progress.source === "manual") ? <span className="ui-caption text-text-muted">{t("pulls.fix.refreshHint")}</span> : null}
    {progress.source === "manual" ? <button type="button" className="pull-check-link" aria-label={t("pulls.fix.dismiss")} onClick={onDismiss}><X size={12} /></button> : null}
  </div>;
}
