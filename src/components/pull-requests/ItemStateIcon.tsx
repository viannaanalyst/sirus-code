import { CircleCheck, CircleDot, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from "@/components/icons/phosphor";
import type { GithubItem } from "@/client/types";

/** State glyph shared by rows and the detail header. */
export function ItemStateIcon({ item, size = 15 }: { item: Pick<GithubItem, "kind" | "state" | "isDraft">; size?: number }) {
  if (item.kind === "issue") return item.state === "open" ? <CircleDot size={size} className="pulls-open" /> : <CircleCheck size={size} className="pulls-merged" />;
  if (item.state === "merged") return <GitMerge size={size} className="pulls-merged" />;
  if (item.state === "closed") return <GitPullRequestClosed size={size} className="pulls-closed" />;
  return item.isDraft ? <GitPullRequestDraft size={size} className="text-text-muted" /> : <GitPullRequest size={size} className="pulls-open" />;
}
