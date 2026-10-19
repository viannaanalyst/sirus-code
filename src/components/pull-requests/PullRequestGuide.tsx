import { useMemo, useState } from "react";
import { Signpost, Sparkles, Trash2 } from "@/components/icons/phosphor";
import type { FileChange, GithubItem, ReviewGuideAnchor } from "@/client/types";
import { DiffViewer, type DiffFocus } from "@/components/DiffViewer";
import { ReviewGuideTour } from "@/components/review-guide/ReviewGuideTour";
import { useReviewGuide } from "@/components/review-guide/use-review-guide";
import { useTranslation } from "@/i18n/use-translation";
import { cachedDiffLines } from "@/lib/diff-cache";
import { formatUnknownError } from "@/lib/format-error";
import { anchorRows, clampStep, findGuideFile, guideIsStale } from "@/lib/review-guide";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/primitives/Dropdown";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { useAppStore } from "@/store/app-store";

type DiffFile = { path: string; diff: string; additions: number; deletions: number };

/**
 * The Guide tab of a pull request (ADR-125): the tour an agent wrote, with the diff of the
 * current step's anchor scrolled to and highlighted; or a way to ask an agent for one.
 */
export function PullRequestGuide({ item, headOid, diff, diffError, canAsk, onAsk }: {
  item: GithubItem; headOid: string | null; diff: { files: DiffFile[]; truncated: boolean } | null; diffError: string | null; canAsk: boolean; onAsk: () => void;
}) {
  const t = useTranslation();
  const target = useMemo(() => ({ kind: "pullRequest" as const, repository: item.repository, number: item.number }), [item.repository, item.number]);
  const { guide, loaded, error, remove } = useReviewGuide(target);
  const [position, setPosition] = useState({ step: 0, anchor: 0 });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const step = guide ? clampStep(position.step, guide.steps.length) : 0;
  const anchors = guide?.steps[step]?.anchors ?? [];
  const anchor = anchors[Math.min(position.anchor, anchors.length - 1)] ?? null;
  const file = anchor && diff ? findGuideFile(diff.files, anchor.path) : null;
  const lines = useMemo(() => cachedDiffLines(file?.diff ?? ""), [file?.diff]);
  const rows = anchor && file ? anchorRows(lines, anchor) : null;
  const focus: DiffFocus | null = rows && guide ? { key: `${guide.revision}:${step}:${position.anchor}`, ...rows } : null;
  const fileLines = useMemo(() => new Map((diff?.files ?? []).map((entry) => [entry.path, cachedDiffLines(entry.diff)])), [diff]);
  const missing = (candidate: ReviewGuideAnchor) => {
    if (!diff) return null;
    const found = findGuideFile(diff.files, candidate.path);
    if (!found) return t("guide.fileMissing", { path: candidate.path });
    return anchorRows(fileLines.get(found.path) ?? [], candidate) ? null : t("guide.linesMissing");
  };

  if (error) return <p role="alert" className="ui-description text-danger">{t(error)}</p>;
  if (!loaded) return <p role="status" className="ui-description text-text-muted">{t("guide.loading")}</p>;
  if (!guide) return <div className="guide-empty">
    <span className="guide-empty-icon" aria-hidden="true"><Signpost size={20} /></span>
    <h3 className="ui-title text-text-primary">{t("guide.emptyTitle")}</h3>
    <p className="max-w-[440px] ui-description text-text-muted">{t(canAsk ? "guide.emptyPull" : "guide.noProject")}</p>
    <InteractiveButton variant="secondary" glow={false} disabled={!canAsk} onClick={onAsk} className="mt-2"><Sparkles size={14} aria-hidden="true" />{t("guide.ask")}</InteractiveButton>
  </div>;

  const change: FileChange | null = file ? { path: file.path, kind: "modified", additions: file.additions, deletions: file.deletions } : null;
  const menu = <Dropdown>
    <DropdownTrigger asChild><button type="button" className="pulls-more ui-control h-[26px]" aria-label={t("guide.more")}>···</button></DropdownTrigger>
    <DropdownContent align="end" side="bottom">
      <DropdownItem icon={<Sparkles size={15} />} disabled={!canAsk} onSelect={onAsk}>{t("guide.rewrite")}</DropdownItem>
      <DropdownSeparator />
      <DropdownItem icon={<Trash2 size={15} />} destructive onSelect={() => setConfirmDelete(true)}>{t("guide.delete")}</DropdownItem>
    </DropdownContent>
  </Dropdown>;
  return <div className="guide-pane">
    <ReviewGuideTour guide={guide} step={step} onStep={(next) => setPosition({ step: next, anchor: 0 })} anchor={position.anchor} onAnchor={(next) => setPosition({ step, anchor: next })}
      missing={missing} stale={guideIsStale(guide, headOid)} menu={menu} />
    {diffError ? <p role="alert" className="ui-description text-danger">{t(diffError)}</p> : null}
    {!diff && !diffError ? <p role="status" className="ui-description text-text-muted">{t("common.loading")}</p> : null}
    {diff?.truncated ? <p className="ui-caption text-text-muted">{t("pulls.diffTruncated")}</p> : null}
    {change && file ? <div className="guide-diff">
      <DiffViewer hideFileList changes={[change]} selected={change} diff={file.diff} onSelect={() => {}} emptyDiffMessage={t("pulls.noDiff")} focus={focus} />
    </div> : null}
    <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={t("guide.deleteTitle")} description={t("guide.deleteBody")} confirmLabel={t("guide.delete")}
      onConfirm={async () => {
        try { await remove(); return true; }
        catch (reason) { useAppStore.setState({ error: formatUnknownError(reason) }); return false; }
      }} />
  </div>;
}
